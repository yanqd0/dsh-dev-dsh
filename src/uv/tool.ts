/**
 * The model-facing `uv` tool: definition, renderer, and installation.
 *
 * Contract (full rationale in `notes/uv.md`): uv runs inside the plugin
 * process through `ctx.subprocess`, so the session file sandbox never sees it —
 * that is what removes the per-call escalation approval. The behaviour the
 * model sees is a pass-through: argv in, uv's own output out, exit status as a
 * marker line. The few risky classes `policy.ts` flags are the only place a
 * human is asked, once per session per class.
 */

import { ensureAskAllowed, createGrantStore, ASK_REJECTED_NOTE } from './approval.js';
import type { GrantStore } from './approval.js';
import { cwdEscape, dedupeMatches, findAskMatches, resolveUvCwd, stripUvPrefix } from './policy.js';
import type { AskMatch } from './policy.js';
import { runUv } from './run.js';
import type { UvRunResult } from './run.js';
import type {
  ApprovalLike,
  ContentBlockLike,
  DshContextLike,
  SubprocessLike,
  ToolDefinitionLike,
  ToolExecutionLike,
  ToolsLike,
} from './types.js';
import type { UvConfig } from './config.js';

/** The registered tool name; also the `toolName` on the approval audit pair. */
export const UV_TOOL_NAME = 'uv';

/** Ascending system-prompt order for the tool-first guidance (100–199 band). */
export const UV_GUIDANCE_ORDER = 113;

/**
 * One-line tool-first policy. The tool description documents the mechanism and
 * `notes/uv.md` documents the design; neither repeats this sentence, because it
 * ships on every request.
 */
export const UV_TOOL_GUIDANCE =
  'uv 命令一律走宿主 uv 工具（插件进程内执行：不经 bash 沙箱、无需授权）；' +
  '仅当需要 shell 管道/重定向/heredoc、或该工具不可用时才退回 bash，并按常规提权审批。';

/** Model-facing tool description; every line costs request budget. */
export const UV_TOOL_DESCRIPTION = [
  '运行 uv（Python 包管理器）；args 即 uv 的参数数组（不含 `uv` 本身，误带开头的 `uv`/`uvx` 会被忽略）。',
  '例：["sync"]、["add","numpy"]、["run","pytest","-q"]、["lock","--check"]、["--version"]。',
  '命令在插件进程内执行：不经 bash、不受会话文件沙箱约束、无需授权（HOME 下的 uv 缓存等写入正常可用）。',
  'cwd 缺省为会话工作目录；需要管道/重定向/heredoc 时请先写脚本文件，再用 ["run","python","<脚本>"]。',
  '输出为 uv 的 stdout/stderr 与 `[exit code: N]` 标记；超长只留尾部并给出完整输出文件路径。',
  '少数危险操作（self update、publish、cache clean|prune、python install|uninstall、tool install|uninstall|upgrade、auth、pip --system、以及 --directory/--project/--cache-dir/--config-file/cwd 指向会话目录之外）按同会话首次询问授权；无审批通道时这些操作会被拒绝。',
].join('\n');

/** The tool's structured value; mirrors the declared `output.schema`. */
export interface UvToolValue {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  notes: string[];
}

/** Outcome of one installation attempt (synchronous, observable in tests). */
export interface UvInstallResult {
  ok: boolean;
  reason?: string | undefined;
}

/** Parameters parsed from the model's arguments. */
interface UvToolArgs {
  args: string[];
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

/** Either parsed arguments or a model-readable refusal. */
type ParseOutcome = { ok: true; value: UvToolArgs } | { ok: false; error: string };

/** Narrow an unknown value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Narrow an unknown service to one exposing `method`, or `undefined`. */
function serviceWith<T>(value: unknown, method: string): T | undefined {
  const record = asRecord(value);
  return record !== undefined && typeof record[method] === 'function' ? (value as T) : undefined;
}

/** Read an unknown value as a string list, or `undefined` when it is not one. */
function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    out.push(entry);
  }
  return out;
}

/** Keep the string entries of a list-valued field, ignoring anything else. */
function stringEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry === 'string') {
      out.push(entry);
    }
  }
  return out;
}

/** Message text for an unknown thrown value. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parse and validate the model's arguments.
 *
 * The registry validates `parameters` first, so these checks only guard the
 * structural gaps it cannot express (empty argv, a non-positive timeout).
 */
export function parseUvToolArgs(raw: unknown): ParseOutcome {
  const record = asRecord(raw);
  const args = readStringList(record?.args);
  if (args === undefined) {
    return { ok: false, error: '参数 args 必须是字符串数组（uv 命令行参数，不含 `uv` 本身）' };
  }
  if (args.length === 0) {
    return { ok: false, error: '参数 args 为空；至少给出一个 uv 参数，如 ["--version"]' };
  }
  const cwd = record?.cwd;
  if (cwd !== undefined && typeof cwd !== 'string') {
    return { ok: false, error: '参数 cwd 必须是字符串路径' };
  }
  const timeoutMs = record?.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    return { ok: false, error: '参数 timeoutMs 必须是正数（毫秒）' };
  }
  return { ok: true, value: { args, cwd, timeoutMs } };
}

/**
 * Render one result the way the bash tool renders its runs: uv's stdout, then a
 * marked stderr section, then the marker lines (truncation notices ride inside
 * their stream, timeouts and exit status come last).
 *
 * @param value - the canonical value produced by `execute`.
 * @returns the model-facing text.
 */
export function renderUvOutcome(value: unknown): string {
  const record = asRecord(value) ?? {};
  const stdout = typeof record.stdout === 'string' ? record.stdout.trimEnd() : '';
  const stderr = typeof record.stderr === 'string' ? record.stderr.trimEnd() : '';
  const notes = stringEntries(record.notes);
  let body = stdout;
  if (stderr.length > 0) {
    if (body.length > 0) {
      body += '\n';
    }
    body += `[stderr]\n${stderr}`;
  }
  const lines = [body, ...notes].filter((line) => line.length > 0);
  return lines.length === 0 ? '(no output)' : lines.join('\n');
}

/** Build the child environment: forwarded ambient names, then explicit entries. */
export function buildUvEnv(
  config: UvConfig,
  ambient: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of config.passEnv) {
    const value = ambient[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  for (const [name, value] of Object.entries(config.env)) {
    env[name] = value;
  }
  return env;
}

/** A refused call whose only content is the explanation. */
function refused(note: string): UvToolValue {
  return { ok: false, exitCode: -1, stdout: '', stderr: '', notes: [note] };
}

/** Clamp a per-call timeout to the configured ceiling. */
export function effectiveTimeout(requested: number | undefined, config: UvConfig): number {
  if (requested === undefined) {
    return config.timeoutMs;
  }
  return Math.min(requested, config.maxTimeoutMs);
}

/**
 * Register the `uv` tool on one scope.
 *
 * Registration is an effect of the injected scope, so unloading the plugin
 * removes the tool. A duplicate name (`uv` already registered by another
 * plugin) is reported instead of thrown: this package must never fail a
 * profile start over its optional submodule.
 *
 * @param scope - a context whose `tools` and `subprocess` services are active.
 * @param config - the submodule config.
 * @param log - one-line failure sink (defaults to stderr).
 * @returns the installation result.
 */
export function installUvTool(
  scope: DshContextLike,
  config: UvConfig,
  log: (message: string) => void = (message) => process.stderr.write(`${message}\n`)
): UvInstallResult {
  const tools = serviceWith<ToolsLike>(scope.get('tools'), 'register');
  const subprocess = serviceWith<SubprocessLike>(scope.get('subprocess'), 'spawn');
  if (tools === undefined || subprocess === undefined) {
    return { ok: false, reason: 'tools 或 subprocess 服务不可用' };
  }
  const store: GrantStore = createGrantStore();
  const approval = serviceWith<ApprovalLike>(scope.get('approval'), 'request');

  const definition: ToolDefinitionLike = {
    name: UV_TOOL_NAME,
    description: UV_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'uv 参数数组，不含 `uv` 本身；如 ["add","numpy"]；任意子命令加 --help 查详情',
        },
        cwd: {
          type: 'string',
          description: '相对会话工作目录的工作目录；越出会话工作目录会先询问授权',
        },
        timeoutMs: {
          type: 'number',
          description: '本次调用的墙钟上限（毫秒），可被挂载行的 uv.maxTimeoutMs 截断',
        },
      },
      required: ['args'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok', 'exitCode', 'stdout', 'stderr', 'notes'],
        additionalProperties: false,
      },
      render: (_args, value): ContentBlockLike[] => [
        { type: 'text', text: renderUvOutcome(value) },
      ],
    },
    execute: async (rawArgs: unknown, exec: ToolExecutionLike): Promise<UvToolValue> =>
      executeUvTool(rawArgs, exec, {
        config,
        subprocess,
        approval,
        store,
      }),
  };
  try {
    // The registry owns the disposer through the calling context's effect, so
    // unloading the injected scope removes the tool; we only report the outcome.
    tools.register(definition);
  } catch (error) {
    const reason = detailOf(error);
    log(`[dsh-dev-dsh] uv 工具注册失败：${reason}`);
    return { ok: false, reason };
  }
  return { ok: true };
}

/** The services the body closes over. */
interface BodyContext {
  readonly config: UvConfig;
  readonly subprocess: SubprocessLike;
  /** Approval is optional: compositions without it fail closed on risky calls. */
  readonly approval: ApprovalLike | undefined;
  readonly store: GrantStore;
}

/** One tool call: parse → classify → consent → run. */
async function executeUvTool(
  rawArgs: unknown,
  exec: ToolExecutionLike,
  body: BodyContext
): Promise<UvToolValue> {
  const parsed = parseUvToolArgs(rawArgs);
  if (!parsed.ok) {
    return refused(`[uv] 未执行：${parsed.error}`);
  }
  const { args, cwd: requestedCwd, timeoutMs } = parsed.value;
  const sessionCwd = exec.agent?.session?.header?.cwd ?? process.cwd();
  const cwd = resolveUvCwd(sessionCwd, requestedCwd);
  const matches: AskMatch[] = findAskMatches(args, cwd);
  if (requestedCwd !== undefined) {
    const escape = cwdEscape(cwd, sessionCwd);
    if (escape !== undefined) {
      matches.push(escape);
    }
  }
  const decision = await ensureAskAllowed({
    approval: body.approval,
    agent: exec.agent,
    sessionId: exec.agent?.session?.id,
    callId: exec.callId,
    signal: exec.signal,
    matches: dedupeMatches(matches),
    autoApprove: body.config.autoApprove,
    grant: body.config.grant,
    store: body.store,
  });
  if (!decision.allowed) {
    return refused(decision.note ?? ASK_REJECTED_NOTE);
  }
  const result: UvRunResult = await runUv({
    subprocess: body.subprocess,
    entry: body.config.entry,
    args: stripUvPrefix(args),
    cwd,
    timeoutMs: effectiveTimeout(timeoutMs, body.config),
    maxOutputBytes: body.config.maxOutputBytes,
    maxSpillBytes: body.config.maxSpillBytes,
    env: buildUvEnv(body.config),
    // The registry always supplies a signal; a lean context without one simply
    // gets a signal that never aborts.
    signal: exec.signal ?? new AbortController().signal,
  });
  return decision.note === undefined
    ? result
    : { ...result, notes: [decision.note, ...result.notes] };
}
