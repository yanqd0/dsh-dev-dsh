/**
 * Risk classification for one `uv` invocation — a pure function over the argv
 * array and the directory the command will run in.
 *
 * Design stance (see `notes/uv.md`): the tool's default is **allow**, matching
 * the model's normal `uv sync`/`lock`/`run`/`add`/`pip`/`build` work. Only the
 * few classes below ask for consent, and an unrecognized invocation is allowed
 * — a false positive costs one same-session prompt, a false negative would
 * silently widen trust, so the token tables are pinned here and covered by
 * tests rather than inferred from `uv --help` at runtime.
 *
 * Matching is token-level, not a shell parse: `["run","python","-c","…"]` is
 * three argv entries, so text inside a model-supplied script never matches. The
 * known consequence is that anything *inside* `uv run`/`uvx` (a wrapper that
 * itself runs `uv cache clean`) is outside this scan — that is inherent to
 * trusting `uv run` at all and is recorded as a known limitation.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** One matched ask class: a stable id (the grant key) and a human reason. */
export interface AskMatch {
  readonly id: string;
  readonly reason: string;
}

/** The closed set of built-in ask classes, plus the parameterized escape id. */
export type AskClassId =
  | 'self-update'
  | 'cache-clean'
  | 'cache-prune'
  | 'python-install'
  | 'python-uninstall'
  | 'tool-install'
  | 'tool-uninstall'
  | 'tool-upgrade'
  | 'publish'
  | 'auth'
  | 'pip-system';

/** One ask class: the class id, the human-facing reason, and detection data. */
export interface AskRule {
  readonly id: AskClassId;
  /** The reason shown in the approval prompt (Chinese, user-facing). */
  readonly reason: string;
}

interface SequenceRule extends AskRule {
  readonly sequence: readonly string[];
}

/**
 * Consecutive-token rules. Order matters only for reporting; every match is
 * reported, so a command naming two classes lists both reasons.
 */
export const SEQUENCE_RULES: readonly SequenceRule[] = [
  {
    id: 'self-update',
    sequence: ['self', 'update'],
    reason: 'uv self update：替换 uv 自身的二进制（工具链升级）',
  },
  {
    id: 'cache-clean',
    sequence: ['cache', 'clean'],
    reason: 'uv cache clean：清空共享缓存 ~/.cache/uv，之后所有项目都要重新下载',
  },
  {
    id: 'cache-prune',
    sequence: ['cache', 'prune'],
    reason: 'uv cache prune：删除共享缓存 ~/.cache/uv 中未被引用的条目',
  },
  {
    id: 'python-install',
    sequence: ['python', 'install'],
    reason: 'uv python install：向 uv 管理的 Python 安装目录写入解释器（会话工作区之外）',
  },
  {
    id: 'python-uninstall',
    sequence: ['python', 'uninstall'],
    reason: 'uv python uninstall：删除 uv 管理的 Python 解释器',
  },
  {
    id: 'tool-install',
    sequence: ['tool', 'install'],
    reason: 'uv tool install：向 uv 全局工具目录与 bin 目录写入（会话工作区之外）',
  },
  {
    id: 'tool-uninstall',
    sequence: ['tool', 'uninstall'],
    reason: 'uv tool uninstall：删除 uv 全局工具',
  },
  {
    id: 'tool-upgrade',
    sequence: ['tool', 'upgrade'],
    reason: 'uv tool upgrade：升级 uv 全局工具',
  },
];

/** Single-token rules: the token *is* the risky subcommand anywhere in argv. */
export const TOKEN_RULES: readonly AskRule[] = [
  { id: 'publish', reason: 'uv publish：向包索引上传制品，不可撤销' },
  { id: 'auth', reason: 'uv auth：读写 uv 的凭据存储（登录态/令牌）' },
];

/**
 * Options that redirect a write target. A value inside the session workspace is
 * ordinary; anything else writes outside the sandbox boundary the tool is
 * bypassing, so it asks once per target directory.
 */
export const ESCAPE_FLAGS: readonly string[] = [
  '--directory',
  '--project',
  '--cache-dir',
  '--config-file',
  // `uv pip install` destinations outside the project environment
  '--target',
  '--prefix',
  '--root',
];

/** Pure help/version invocations never ask: they write nothing. */
export function isHelpOrVersion(args: readonly string[]): boolean {
  if (args.includes('--help') || args.includes('-h')) {
    return true;
  }
  if (args.includes('--version') || args.includes('-V')) {
    return true;
  }
  return args[0] === 'help';
}

/**
 * Drop a leading `uv` token the model may have included by habit.
 *
 * @param args - model-supplied argv.
 * @returns argv without a leading `uv`/`uvx` token.
 */
export function stripUvPrefix(args: readonly string[]): string[] {
  const [first] = args;
  return first === 'uv' || first === 'uvx' ? args.slice(1) : [...args];
}

/** First value bound to `flag`, in either `--flag value` or `--flag=value` form. */
export function flagValue(args: readonly string[], flag: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }
    if (token === flag) {
      return args[index + 1];
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }
  return undefined;
}

/** True when `tokens` contains `sequence` as consecutive entries. */
function containsSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || tokens.length < sequence.length) {
    return false;
  }
  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    if (sequence.every((token, offset) => tokens[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

/**
 * Canonicalize a write target for containment checks.
 *
 * The sandbox decides on canonical paths, so a symlink that points out of the
 * workspace must ask even though its lexical path looks inside. A target that
 * does not exist yet has no canonical form; the lexical resolution is used, and
 * the miss is recorded as the remaining gap.
 */
export function canonicalTarget(value: string, cwd: string): string {
  const absolute = resolve(cwd, value);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** True when `target` is `root` itself or sits under it. */
export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Resolve the tool's `cwd` argument against the session directory. */
export function resolveUvCwd(sessionCwd: string, requested: string | undefined): string {
  if (requested === undefined || requested.trim().length === 0) {
    return sessionCwd;
  }
  return resolve(sessionCwd, requested);
}

/** A `cwd` argument that leaves the session workspace, when that is a risk. */
export function cwdEscape(requested: string, sessionCwd: string): AskMatch | undefined {
  const target = canonicalTarget(requested, sessionCwd);
  if (isWithin(sessionCwd, target)) {
    return undefined;
  }
  return {
    id: `cwd-escape:${target}`,
    reason: `目标目录在会话工作区之外：${target}（--directory/--project/cwd 等）`,
  };
}

/**
 * Every ask class one invocation matches, escapes included.
 *
 * @param args - argv without the executable (a leading `uv` is tolerated).
 * @param cwd - the directory the command will run in (already resolved).
 * @returns the matched classes, de-duplicated by id, in table order.
 */
export function findAskMatches(args: readonly string[], cwd: string): AskMatch[] {
  const tokens = stripUvPrefix(args);
  if (isHelpOrVersion(tokens)) {
    return [];
  }
  const matches: AskMatch[] = [];
  for (const rule of SEQUENCE_RULES) {
    if (containsSequence(tokens, rule.sequence)) {
      matches.push({ id: rule.id, reason: rule.reason });
    }
  }
  for (const rule of TOKEN_RULES) {
    if (tokens.includes(rule.id)) {
      matches.push({ id: rule.id, reason: rule.reason });
    }
  }
  const pipRule = pipSystemMatch(tokens, cwd);
  if (pipRule !== undefined) {
    matches.push(pipRule);
  }
  return dedupeMatches([...matches, ...findEscapes(tokens, cwd)]);
}

/**
 * `uv pip …` writing outside the project environment: `--system`, or an
 * `--python` that names an interpreter path outside the session workspace.
 */
function pipSystemMatch(tokens: readonly string[], cwd: string): AskMatch | undefined {
  if (!tokens.includes('pip')) {
    return undefined;
  }
  if (tokens.includes('--system')) {
    return {
      id: 'pip-system',
      reason: 'uv pip：目标为项目环境之外的 Python（--system），会写系统解释器',
    };
  }
  const python = flagValue(tokens, '--python');
  if (python === undefined || !(python.includes('/') || python.includes('\\'))) {
    return undefined;
  }
  const target = canonicalTarget(python, cwd);
  if (isWithin(cwd, target)) {
    return undefined;
  }
  return {
    id: `cwd-escape:${target}`,
    reason: `uv pip：目标解释器在会话工作区之外：${target}（--python）`,
  };
}

/** Escape classes from flags that point a write at a directory. */
export function findEscapes(tokens: readonly string[], cwd: string): AskMatch[] {
  const matches: AskMatch[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    for (const flag of ESCAPE_FLAGS) {
      const value = token === flag ? tokens[index + 1] : inlineFlagValue(token, flag);
      if (value === undefined || value.trim().length === 0) {
        continue;
      }
      const target = canonicalTarget(value, cwd);
      if (!isWithin(cwd, target)) {
        matches.push({
          id: `cwd-escape:${target}`,
          reason: `目标目录在会话工作区之外：${target}（${flag}）`,
        });
      }
    }
  }
  return dedupeMatches(matches);
}

/** The `--flag=value` form of one token, when it names `flag`. */
function inlineFlagValue(token: string, flag: string): string | undefined {
  return token.startsWith(`${flag}=`) ? token.slice(flag.length + 1) : undefined;
}

/**
 * Keep first occurrences, in order — one prompt should not repeat a class.
 *
 * @param matches - matched classes, possibly with duplicates.
 * @returns the de-duplicated list.
 */
export function dedupeMatches(matches: readonly AskMatch[]): AskMatch[] {
  const seen = new Set<string>();
  const out: AskMatch[] = [];
  for (const match of matches) {
    if (!seen.has(match.id)) {
      seen.add(match.id);
      out.push(match);
    }
  }
  return out;
}
