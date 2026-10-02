/**
 * Run one `uv` invocation through the host subprocess service.
 *
 * Why `ctx.subprocess` and not `node:child_process`: the service owns bounded
 * collected output with a whole-stream spill file, managed-range termination
 * (SIGTERM → grace → SIGKILL, including descendants), and the ambient
 * credential scrub — all of which a hand-rolled `spawn` would have to
 * re-derive. It is also the one seam a composition can replace with a remote
 * implementation, so the tool follows where the deployment runs commands.
 *
 * Confinement is deliberately absent: `ctx.sandbox` is applied by the *bash
 * executor*, not by the subprocess service, which is exactly what makes this
 * tool zero-approval. That is the trust boundary recorded in `notes/uv.md`.
 *
 * Output shape mirrors the bash tool's model-facing conventions (a `[stderr]`
 * section, truncated-tail notices, `[exit code: N]` last) so the model's
 * reading habits carry over; the spelling is a convention of this package, not
 * a host contract.
 */

import { UV_ENTRY_HINT, looksLikePath, resolveUvCommand } from './entry.js';
import { stripUvPrefix } from './policy.js';
import type {
  SubprocessHandleLike,
  SubprocessLike,
  SubprocessOutputReaderLike,
  SubprocessSpawnSpecLike,
} from './types.js';

/** Termination grace handed to the subprocess service (milliseconds). */
export const DEFAULT_GRACE_MS = 5_000;

/** Everything one run needs; `env` is already fully merged by the caller. */
export interface UvRunRequest {
  readonly subprocess: SubprocessLike;
  /** Mount-line `uv.entry`; `undefined` resolves `uv` on the child's PATH. */
  readonly entry: string | undefined;
  /** argv without the executable (a leading `uv`/`uvx` is stripped). */
  readonly args: readonly string[];
  readonly cwd: string;
  /** Wall-clock limit; the run aborts through the spawn signal when it fires. */
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxSpillBytes: number;
  readonly env: NodeJS.ProcessEnv;
  /** Caller cancellation (`exec.signal`), fused with the internal deadline. */
  readonly signal: AbortSignal;
}

/** Canonical value of the `uv` tool; `output.schema` declares exactly these fields. */
export interface UvRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Model-facing marker lines, already in bash-tool order. */
  notes: string[];
}

/**
 * Execute one uv command.
 *
 * Never throws: entry misses, spawn rejections, timeouts, and signal kills all
 * come back as a result whose `notes` explain what happened, matching the
 * pass-through contract of the tool channel.
 *
 * @param request - argv, directory, limits, environment, and cancellation.
 * @returns the canonical tool value.
 */
export async function runUv(request: UvRunRequest): Promise<UvRunResult> {
  if (request.signal.aborted) {
    return failure('[stopped: tool call aborted]');
  }
  let command: string;
  try {
    command = resolveUvCommand(request.entry);
  } catch (error) {
    return failure(`[uv] 未执行：${detailOf(error)}`);
  }
  let executable: string;
  try {
    executable = looksLikePath(command)
      ? command
      : await request.subprocess.resolveExecutable(
          command,
          definedEnv(request.env),
          request.signal
        );
  } catch (error) {
    return failure(
      `[uv] 未执行：无法解析 uv 可执行文件（entry=${command}）：${detailOf(error)}\n${UV_ENTRY_HINT}`
    );
  }

  const controller = new AbortController();
  const relayAbort = (): void => {
    controller.abort();
  };
  request.signal.addEventListener('abort', relayAbort, { once: true });
  let handle: SubprocessHandleLike | undefined;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    handle?.terminate();
  }, request.timeoutMs);
  const cleanup = (): void => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', relayAbort);
  };

  const spec: SubprocessSpawnSpecLike = {
    argv: [executable, ...stripUvPrefix(request.args)],
    cwd: request.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: request.maxOutputBytes, spill: { maxBytes: request.maxSpillBytes } },
      stderr: { maxBytes: request.maxOutputBytes, spill: { maxBytes: request.maxSpillBytes } },
    },
    graceMs: DEFAULT_GRACE_MS,
    signal: controller.signal,
    env: request.env,
  };
  try {
    handle = request.subprocess.spawn(spec);
  } catch (error) {
    cleanup();
    return failure(`[uv] 未执行：子进程未启动：${detailOf(error)}`);
  }

  let outcome: { exitCode: number | null; signal: string | null };
  try {
    outcome = await handle.done;
  } catch (error) {
    cleanup();
    return failure(`[uv] 子进程未报告结果：${detailOf(error)}`);
  }
  cleanup();

  const notes: string[] = [];
  if (timedOut) {
    notes.push(`[timed out after ${request.timeoutMs}ms]`);
  } else if (request.signal.aborted) {
    notes.push('[stopped: tool call aborted]');
  }
  const exitCode = outcome.exitCode ?? -1;
  if (outcome.signal !== null) {
    notes.push(`[killed by signal: ${outcome.signal}]`);
  } else if (exitCode !== 0) {
    notes.push(`[exit code: ${exitCode}]`);
  }
  return {
    ok: outcome.signal === null && exitCode === 0 && !timedOut,
    exitCode,
    stdout: readStream(handle.collected.stdout),
    stderr: readStream(handle.collected.stderr),
    notes,
  };
}

/**
 * Read one collected stream from offset 0, appending the truncation notice to
 * its own text — the shape the bash tool renders.
 */
function readStream(reader: SubprocessOutputReaderLike | undefined): string {
  if (reader === undefined) {
    return '';
  }
  const read = reader.readFrom(0);
  if (!read.lossy && read.spillPath === undefined) {
    return read.text;
  }
  return `${read.text}\n[output truncated; full output: ${read.spillPath ?? '(unavailable)'}]`;
}

/** A result that ran nothing, with one explanatory note. */
function failure(note: string): UvRunResult {
  return { ok: false, exitCode: -1, stdout: '', stderr: '', notes: [note] };
}

/** The defined entries of an environment, shaped for executable resolution. */
function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      out[name] = value;
    }
  }
  return out;
}

/** Message text for an unknown thrown value. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
