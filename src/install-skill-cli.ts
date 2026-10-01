import {
  installSkill,
  resolveDshHome,
  skillInstallState,
  skillSource,
  skillTarget,
} from './install-skill.js';
import { resolve } from 'node:path';

// The install entry. `node dist/install-skill.js` (postinstall, no arguments)
// keeps the package-manager contract: the sync never fails the install —
// installSkill resolves every failure to `{ ok: false }` after a log line, and
// this module has no top-level await or throw.
//
//   node dist/install-skill.js [--link | --copy] [--force] [--verify]
//
// `--link` is the dogfooding mode: the installed directory becomes a symlink to
// this repo's `skill/`, so worktree edits reach the next skill load with no
// build and no sync. `--verify` checks the installed directory against the
// source and exits non-zero when it does not match — the one command that
// reports a stale install instead of silently tolerating it.

const USAGE = 'usage: install-skill [--link | --copy] [--force] [--verify] [--source <dir>]';

type Mode = 'copy' | 'link';

/** Parsed CLI arguments. */
export interface InstallArgs {
  readonly mode: Mode;
  readonly force: boolean;
  readonly verify: boolean;
  /** Explicit source directory, or `undefined` for the bundled `dist/skill`. */
  readonly source: string | undefined;
}

/** Parsed arguments, or the usage diagnostic to print. */
export type ParsedArgs = { ok: true; args: InstallArgs } | { ok: false; message: string };

/** Output surface, injected so the CLI logic is callable from tests. */
export interface CliIo {
  /** Write one stderr line. */
  log: (message: string) => void;
  /** Record the process exit code for this invocation. */
  setExitCode: (code: number) => void;
}

/** Path surface, injected so tests can verify a temporary pair. */
export interface CliPaths {
  /** Bundled skill directory: `dist/skill` in the built entry, absent under `src/`. */
  readonly source: string;
  /** Installed skill directory: `<DSH_HOME>/skills/<name>`. */
  readonly target: string;
}

/** Environment surface, injected so no test has to mutate the process. */
export interface CliEnv {
  /** DSH_HOME for the install target. */
  readonly dshHome: string;
}

const defaultEnv = (): CliEnv => ({ dshHome: resolveDshHome() });

const defaultPaths = (env: CliEnv): CliPaths => ({
  source: skillSource(),
  target: skillTarget(env.dshHome),
});

/**
 * Parse argv into a mode, or report usage.
 *
 * @param argv - arguments after the script path.
 * @returns parsed arguments, or the usage message an unknown or conflicting
 *   combination produces.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let mode: Mode | undefined;
  let force = false;
  let verify = false;
  let source: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--link') {
      if (mode === 'copy') return { ok: false, message: `--link conflicts with --copy\n${USAGE}` };
      mode = 'link';
    } else if (arg === '--copy') {
      if (mode === 'link') return { ok: false, message: `--copy conflicts with --link\n${USAGE}` };
      mode = 'copy';
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--verify') {
      verify = true;
    } else if (arg === '--source') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, message: `--source needs a directory\n${USAGE}` };
      }
      source = value;
      index += 1;
    } else {
      return { ok: false, message: `unknown argument "${arg}"\n${USAGE}` };
    }
  }
  // `--verify` writes nothing, so a mode beside it is a misunderstanding of the
  // command rather than a harmless extra.
  if (verify && mode !== undefined) {
    return { ok: false, message: `--verify does not take --link or --copy\n${USAGE}` };
  }
  if (verify && force) {
    return { ok: false, message: `--verify does not take --force\n${USAGE}` };
  }
  // `--source` names the tree the install is made from (link) or checked
  // against (verify); a copy sync always reads the bundled `dist/skill`.
  if (source !== undefined && !verify && mode !== 'link') {
    return { ok: false, message: `--source needs --link or --verify\n${USAGE}` };
  }
  return { ok: true, args: { mode: mode ?? 'copy', force, verify, source } };
}

/**
 * Run one invocation.
 *
 * Never throws: an unknown argument is exit code 2, a failed sync still exits 0
 * (a package install must not fail over the skill), and only `--verify` reports
 * a mismatch with a non-zero code.
 *
 * @param argv - arguments after the script path.
 * @param io - log and exit-code sinks.
 * @param env - environment surface; defaults to the process's `DSH_HOME`.
 * @param paths - path surface; defaults to the bundled source and the resolved
 *   install target. Tests inject a temporary pair.
 */
export function main(
  argv: readonly string[],
  io: CliIo,
  env: CliEnv = defaultEnv(),
  paths: CliPaths = defaultPaths(env)
): void {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    io.log(`[dsh-dev-dsh] ${parsed.message}`);
    io.setExitCode(2);
    return;
  }
  const { mode, force, verify, source } = parsed.args;
  const resolvedSource = source === undefined ? paths.source : resolve(source);
  if (verify) {
    const state = skillInstallState(resolvedSource, paths.target);
    if (state === 'linked') {
      io.log('[dsh-dev-dsh] skill install verified (symlink to the source)');
      return;
    }
    if (state === 'identical') {
      io.log('[dsh-dev-dsh] skill install verified (byte-identical copy)');
      return;
    }
    io.log(
      '[dsh-dev-dsh] skill install does NOT match the source (symlink points elsewhere, or the tree differs) — re-run with --link or --copy'
    );
    io.setExitCode(1);
    return;
  }
  const result = installSkill({
    dshHome: env.dshHome,
    source: resolvedSource,
    link: mode === 'link',
    force,
  });
  if (result.ok && mode === 'link') {
    io.log(
      `[dsh-dev-dsh] ${paths.target} -> ${resolvedSource} — edit the source and the next skill load sees it, no rebuild needed`
    );
  }
  io.setExitCode(0);
}

main(process.argv.slice(2), {
  log: (message) => process.stderr.write(`${message}\n`),
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
