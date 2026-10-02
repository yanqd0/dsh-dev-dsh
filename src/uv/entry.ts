/**
 * Resolve which `uv` executable the tool runs.
 *
 * The mount-line `uv.entry` knob is the only override; `PATH` stays the
 * default. A configured entry may be a bare command name, an absolute path, or
 * a `~`-prefixed path — a YAML value never sees a shell, so the expansion
 * happens here.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The default entry: `uv` as resolved on the child's `PATH`. */
export const DEFAULT_UV_ENTRY = 'uv';

/** Actionable failure text when a configured `uv.entry` path is not on disk. */
export const UV_ENTRY_HINT =
  'uv 入口不存在：挂载行 `uv.entry` 指向的路径在磁盘上找不到。' +
  '请修正 `uv.entry`（如 `~/.local/bin/uv`），或删掉它让工具按 PATH 解析 `uv`。';

/** Expand a leading `~`; anything else is returned unchanged. */
export function expandUvEntry(entry: string): string {
  if (entry === '~') {
    return homedir();
  }
  if (entry.startsWith('~/') || entry.startsWith('~\\')) {
    return join(homedir(), entry.slice(2));
  }
  return entry;
}

/** True when the entry names a filesystem path rather than a bare command. */
export function looksLikePath(entry: string): boolean {
  return entry.includes('/') || entry.includes('\\');
}

/**
 * Resolve the configured entry into the string handed to
 * `ctx.subprocess.resolveExecutable` (bare) or spawned verbatim (path).
 *
 * @param entry - the mount-line `uv.entry`, when configured.
 * @param exists - filesystem probe seam (`fs.existsSync`); tests inject a fake.
 * @returns a bare command name, or an existing path.
 * @throws when a path-shaped entry does not exist — a misconfiguration must
 *   fail loud with {@link UV_ENTRY_HINT}, not as a spawn-time ENOENT.
 */
export function resolveUvCommand(
  entry: string | undefined,
  exists: (path: string) => boolean = existsSync
): string {
  const configured = entry?.trim();
  if (configured === undefined || configured.length === 0) {
    return DEFAULT_UV_ENTRY;
  }
  const expanded = expandUvEntry(configured);
  if (looksLikePath(expanded) && !exists(expanded)) {
    throw new Error(UV_ENTRY_HINT);
  }
  return expanded;
}
