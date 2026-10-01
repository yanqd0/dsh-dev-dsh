import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, parseArgs } from './install-skill-cli.ts';
import { installSkill, skillSource, skillTarget } from './install-skill.ts';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-dsh-cli-'));
  created.push(dir);
  return dir;
}

/** Build a fake bundled-skill source directory containing one SKILL.md. */
function makeSource(body = 'body', extra: Record<string, string> = {}): string {
  const source = join(tempDir(), 'skill');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), body);
  for (const [relative, contents] of Object.entries(extra)) {
    const absolute = join(source, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return source;
}

interface Recorded {
  readonly lines: string[];
  readonly exitCodes: number[];
}

/** Run main against an injected path pair and record what it reported. */
function run(argv: readonly string[], source: string, target: string): Recorded {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  main(
    argv,
    { log: (line) => lines.push(line), setExitCode: (code) => exitCodes.push(code) },
    { dshHome: dirname(dirname(target)) },
    { source, target }
  );
  return { lines, exitCodes };
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('parseArgs', () => {
  it('defaults to the copy mode with no flags', () => {
    expect(parseArgs([])).toEqual({
      ok: true,
      args: { mode: 'copy', force: false, verify: false, source: undefined },
    });
  });

  it('reads link, force, verify and source', () => {
    expect(parseArgs(['--force', '--link'])).toEqual({
      ok: true,
      args: { mode: 'link', force: true, verify: false, source: undefined },
    });
    expect(parseArgs(['--copy'])).toEqual({
      ok: true,
      args: { mode: 'copy', force: false, verify: false, source: undefined },
    });
    expect(parseArgs(['--verify'])).toEqual({
      ok: true,
      args: { mode: 'copy', force: false, verify: true, source: undefined },
    });
    expect(parseArgs(['--link', '--source', 'skill'])).toEqual({
      ok: true,
      args: { mode: 'link', force: false, verify: false, source: 'skill' },
    });
  });

  it('rejects an unknown argument', () => {
    expect(parseArgs(['--nope']).ok).toBe(false);
  });

  it('rejects conflicting or meaningless combinations', () => {
    expect(parseArgs(['--link', '--copy']).ok).toBe(false);
    expect(parseArgs(['--copy', '--link']).ok).toBe(false);
    expect(parseArgs(['--verify', '--link']).ok).toBe(false);
    expect(parseArgs(['--verify', '--force']).ok).toBe(false);
    // A copy sync always reads the bundled source, so `--source` is meaningless there.
    expect(parseArgs(['--copy', '--source', 'skill']).ok).toBe(false);
    expect(parseArgs(['--source', 'skill']).ok).toBe(false);
  });

  it('accepts --source for link and verify', () => {
    expect(parseArgs(['--link', '--source', 'skill']).ok).toBe(true);
    expect(parseArgs(['--verify', '--source', 'skill'])).toEqual({
      ok: true,
      args: { mode: 'copy', force: false, verify: true, source: 'skill' },
    });
  });

  it('rejects a --source without a value', () => {
    expect(parseArgs(['--link', '--source']).ok).toBe(false);
    expect(parseArgs(['--link', '--source', '--force']).ok).toBe(false);
  });
});

describe('postinstall entry', () => {
  /**
   * `install-skill-cli.ts` is a side-effect module: importing it runs the sync
   * once, the way `node dist/install-skill.js` does at postinstall. That side
   * effect cannot be observed from here — the module is cached after the first
   * import — so the entry's contract is exercised through `main` below (never
   * throw, exit 0 on a failed sync) and through `installSkill`'s own missing
   * source and unwritable target cases.
   */
  it('resolves the bundled source directory beside the module', () => {
    expect(skillSource()).toContain('skill');
  });
});

describe('main', () => {
  it('links the target and reports the dev path', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    const result = run(['--link'], source, skillTarget(dshHome));

    expect(result.exitCodes).toEqual([0]);
    expect(result.lines.join('\n')).toContain('no rebuild needed');
    expect(result.lines.join('\n')).toContain(source);
  });

  it('links an explicit --source directory', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    const target = skillTarget(dshHome);
    const result = run(['--link', '--source', source], source, target);

    expect(result.exitCodes).toEqual([0]);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(realpathSync(target)).toBe(realpathSync(source));
  });

  it('still exits 0 when the sync fails (a package install must not fail)', () => {
    const dshHome = tempDir();
    const result = run([], join(tempDir(), 'missing'), skillTarget(dshHome));

    expect(result.exitCodes).toEqual([0]);
    expect(result.lines).toEqual([]);
  });

  it('verifies a link that resolves to the source', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    const target = skillTarget(dshHome);
    installSkill({ dshHome, source, link: true });

    const result = run(['--verify'], source, target);

    expect(result.exitCodes).toEqual([]);
    expect(result.lines.join('\n')).toContain('verified (symlink to the source)');
  });

  it('verifies a byte-identical copy', () => {
    const dshHome = tempDir();
    const source = makeSource('v1', { 'references/a.md': 'a1' });
    const target = skillTarget(dshHome);
    installSkill({ dshHome, source });

    const result = run(['--verify'], source, target);

    expect(result.exitCodes).toEqual([]);
    expect(result.lines.join('\n')).toContain('verified (byte-identical copy)');
  });

  it('fails the verify on a stale or missing install with exit code 1', () => {
    const dshHome = tempDir();
    const result = run(['--verify'], makeSource('v1'), skillTarget(dshHome));

    expect(result.exitCodes).toEqual([1]);
    expect(result.lines.join('\n')).toContain('does NOT match the source');
  });

  it('fails the verify when a symlink points elsewhere', () => {
    const dshHome = tempDir();
    const target = skillTarget(dshHome);
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    symlinkSync(makeSource('v2'), target);

    const result = run(['--verify'], makeSource('v1'), target);

    expect(result.exitCodes).toEqual([1]);
  });

  it('fails an unknown argument with exit code 2', () => {
    const result = run(['--wat'], makeSource('v1'), skillTarget(tempDir()));

    expect(result.exitCodes).toEqual([2]);
    expect(result.lines.join('\n')).toContain('unknown argument');
  });

  it('fails a meaningless combination with exit code 2', () => {
    const result = run(['--verify', '--link'], makeSource('v1'), skillTarget(tempDir()));

    expect(result.exitCodes).toEqual([2]);
    expect(result.lines.join('\n')).toContain('--verify does not take');
  });
});
