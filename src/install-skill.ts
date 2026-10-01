import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Skill auto-install — two triggers share this module:
 *
 * 1. `package.json` postinstall runs `node dist/install-skill.js` (npm always
 *    runs it; pnpm 10+ blocks dependency build scripts unless allow-listed, so
 *    this trigger is best-effort under pnpm).
 * 2. The host plugin calls {@link installSkill} from `apply()` on every load —
 *    the guaranteed path, and the one that survives a blocked postinstall.
 *
 * Semantics are a content SYNC: a target whose whole tree (SKILL.md and every
 * reference file) already matches the bundled one is left untouched (no churn
 * on every session start); anything else is replaced. Comparing the whole tree
 * — not just SKILL.md — is what keeps a changed reference file from leaving a
 * stale install behind. A target that already IS a symlink is left alone — a
 * dev flow that wants to own the directory with a symlink must not be
 * clobbered. Every failure logs one line and returns `{ ok: false }`; it never
 * breaks plugin load or package install.
 *
 * `opts.link` selects the DEV mode of that same sync: instead of copying, the
 * target becomes a symlink to the source directory. The skill provider re-reads
 * every loaded body from disk, so a linked target makes worktree edits visible
 * to the next load with no build and no sync step. This is the dogfooding path
 * (`pnpm run dogfood:skill`); the copying path stays the shipped one, so a
 * published install never depends on a symlink.
 */

const DIRNAME = dirname(fileURLToPath(import.meta.url));

/** The skill name, which is also its directory name under `skills/`. */
export const SKILL_NAME = 'dsh-dev-dsh';

export interface InstallResult {
  ok: boolean;
  reason?: string;
}

/** DSH_HOME from the environment, else `~/.dsh`. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME ?? join(homedir(), '.dsh');
}

/** The bundled skill directory: `dist/skill`, beside this module. */
export function skillSource(): string {
  return join(DIRNAME, 'skill');
}

/** The discovery target `dsh-skill-filesystem` reads (user-dsh root, rank 400). */
export function skillTarget(dshHome: string): string {
  return join(dshHome, 'skills', SKILL_NAME);
}

/** True when the installed skill tree already matches the bundled one. */
export function isCurrent(source: string, target: string): boolean {
  try {
    const bundled = treeSnapshot(source);
    const installed = treeSnapshot(target);
    if (bundled.size !== installed.size) {
      return false;
    }
    for (const [relative, bytes] of bundled) {
      const other = installed.get(relative);
      if (other === undefined || !other.equals(bytes)) {
        return false;
      }
    }
    return true;
  } catch {
    // unreadable or partial installs are never "current"
    return false;
  }
}

/**
 * Read every regular file under `root` into a `relative path -> bytes` map.
 *
 * Directories recurse; symlinks and other irregular entries are skipped, so a
 * tree containing one never counts as "current" (it is replaced, never
 * followed). Relative paths use `/` so the map is portable.
 */
function treeSnapshot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        files.set(relative, readFileSync(join(dir, entry.name)));
      }
    }
  };
  walk(root, '');
  return files;
}

export interface InstallOptions {
  dshHome?: string;
  source?: string;
  log?: (message: string) => void;
  /** DEV mode: make the target a symlink to the source instead of a copy. */
  link?: boolean;
  /** Replace a real directory at the target when `link` is set. */
  force?: boolean;
}

/**
 * Report how the target relates to the source when the target is a symlink.
 *
 * `undefined` means the target is absent or is not a symlink (a copy, or a
 * regular file); `true` means it resolves to the source. Used by the CLI's
 * `--verify`: link mode cannot use the byte comparison, because
 * {@link treeSnapshot} skips symlinks by design.
 *
 * @param source - absolute path of the bundled skill directory.
 * @param target - absolute path of the installed skill directory.
 * @returns the link verdict, or `undefined` when the target is not a symlink.
 */
export function skillTargetsLink(source: string, target: string): boolean | undefined {
  try {
    if (!existsSync(target) || !lstatSync(target).isSymbolicLink()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return resolveSymlink(target) === resolveSymlink(source);
}

/** How an installed skill directory compares to the bundled source. */
export type SkillInstallState = 'identical' | 'linked' | 'stale';

/**
 * Classify the installed skill directory against the bundled source.
 *
 * A symlink target cannot be judged byte-wise ({@link treeSnapshot} skips
 * symlinks by design), so link and copy installs are reported separately. Used
 * by the CLI's `--verify` and by its tests; it reports, it never writes.
 *
 * @param source - absolute path of the bundled skill directory.
 * @param target - absolute path of the installed skill directory.
 * @returns `linked` when the target resolves to the source, `identical` when a
 *   copy matches byte for byte, `stale` otherwise.
 */
export function skillInstallState(source: string, target: string): SkillInstallState {
  const linked = skillTargetsLink(source, target);
  if (linked === true) {
    return 'linked';
  }
  if (linked === undefined && isCurrent(source, target)) {
    return 'identical';
  }
  return 'stale';
}

/** Resolve a path to its real location, tolerating a missing target. */
function resolveSymlink(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Point `target` at `source`; `force` replaces a real directory. */
function linkTarget(
  source: string,
  target: string,
  force: boolean,
  log: (m: string) => void
): InstallResult {
  if (existsSync(target)) {
    const existing = lstatSync(target);
    if (existing.isSymbolicLink()) {
      if (resolveSymlink(target) === resolveSymlink(source)) {
        return { ok: true };
      }
      rmSync(target, { force: true });
    } else if (force) {
      rmSync(target, { recursive: true, force: true });
    } else {
      log(
        `[dsh-dev-dsh] ${target} is a real directory (an installed copy) — re-run with --force to replace it with a symlink`
      );
      return { ok: false, reason: 'target-exists' };
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  // 'dir' keeps the link valid on Windows where junctions are not implied.
  symlinkSync(source, target, 'dir');
  return { ok: true };
}

/**
 * Sync the bundled skill into the DSH skill directory.
 *
 * Never throws: every failure path returns `{ ok: false, reason }` after one
 * log line, so neither a postinstall nor a plugin load can fail over it.
 */
export function installSkill(opts: InstallOptions = {}): InstallResult {
  const log = opts.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const source = opts.source ?? skillSource();
  const target = skillTarget(opts.dshHome ?? resolveDshHome());
  try {
    if (!existsSync(source)) {
      log(`[dsh-dev-dsh] skill source missing (${source}) — skipping skill install`);
      return { ok: false, reason: 'source missing' };
    }
    if (opts.link === true) {
      return linkTarget(source, target, opts.force === true, log);
    }
    if (existsSync(target)) {
      // a dev-flow symlink owns the target — never clobber it
      if (lstatSync(target).isSymbolicLink()) {
        return { ok: true };
      }
      if (isCurrent(source, target)) {
        return { ok: true };
      }
      rmSync(target, { recursive: true, force: true });
    }
    cpSync(source, target, { recursive: true });
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`[dsh-dev-dsh] skill install failed: ${reason}`);
    return { ok: false, reason };
  }
}
