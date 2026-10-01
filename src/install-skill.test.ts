import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SKILL_NAME,
  installSkill,
  resolveDshHome,
  skillInstallState,
  skillSource,
  skillTarget,
  skillTargetsLink,
} from './install-skill.ts';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-dsh-test-'));
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

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('skillSource', () => {
  it('is the bundled skill directory beside the module', () => {
    expect(basename(skillSource())).toBe('skill');
  });
});

describe('resolveDshHome', () => {
  it('prefers DSH_HOME', () => {
    expect(resolveDshHome({ DSH_HOME: '/tmp/custom-home' })).toBe('/tmp/custom-home');
  });

  it('falls back to ~/.dsh', () => {
    expect(resolveDshHome({})).toBe(join(homedir(), '.dsh'));
  });
});

describe('skillTarget', () => {
  it('lands under skills/<name> of the given DSH home', () => {
    expect(skillTarget('/home/x/.dsh')).toBe(join('/home/x/.dsh', 'skills', SKILL_NAME));
  });
});

describe('installSkill', () => {
  it('copies the bundled skill into the target', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');

    expect(installSkill({ dshHome, source })).toEqual({ ok: true });
    expect(readFileSync(join(skillTarget(dshHome), 'SKILL.md'), 'utf8')).toBe('v1');
  });

  it('leaves an up-to-date target untouched (no churn)', () => {
    const dshHome = tempDir();
    const source = makeSource('v1', { 'references/a.md': 'a1' });
    installSkill({ dshHome, source });
    const before = statSync(skillTarget(dshHome)).mtimeMs;

    expect(installSkill({ dshHome, source })).toEqual({ ok: true });
    expect(statSync(skillTarget(dshHome)).mtimeMs).toBe(before);
  });

  it('refreshes the target when only a reference file changed', () => {
    const dshHome = tempDir();
    installSkill({ dshHome, source: makeSource('v1', { 'references/a.md': 'a1' }) });

    expect(
      installSkill({ dshHome, source: makeSource('v1', { 'references/a.md': 'a2' }) })
    ).toEqual({ ok: true });
    expect(readFileSync(join(skillTarget(dshHome), 'SKILL.md'), 'utf8')).toBe('v1');
    expect(readFileSync(join(skillTarget(dshHome), 'references/a.md'), 'utf8')).toBe('a2');
  });

  it('syncs a nested reference tree (three levels deep)', () => {
    const dshHome = tempDir();
    const nested = {
      'references/dsh/index.md': 'dsh index',
      'references/dsh/versions/index.md': 'versions index',
      'references/dsh/versions/0.1.7-to-0.2.0.md': 'diff v1',
    };
    const deep = join(skillTarget(dshHome), 'references/dsh/versions/0.1.7-to-0.2.0.md');

    expect(installSkill({ dshHome, source: makeSource('v1', nested) })).toEqual({ ok: true });
    expect(readFileSync(deep, 'utf8')).toBe('diff v1');

    // A change three levels down still refreshes the whole tree.
    expect(
      installSkill({
        dshHome,
        source: makeSource('v1', {
          ...nested,
          'references/dsh/versions/0.1.7-to-0.2.0.md': 'diff v2',
        }),
      })
    ).toEqual({ ok: true });
    expect(readFileSync(deep, 'utf8')).toBe('diff v2');
  });

  it('refreshes the target when it is missing a bundled reference file', () => {
    const dshHome = tempDir();
    installSkill({ dshHome, source: makeSource('v1') });

    expect(
      installSkill({ dshHome, source: makeSource('v1', { 'references/a.md': 'a1' }) })
    ).toEqual({ ok: true });
    expect(readFileSync(join(skillTarget(dshHome), 'references/a.md'), 'utf8')).toBe('a1');
  });

  it('refreshes the target when it carries an extra file', () => {
    const dshHome = tempDir();
    installSkill({ dshHome, source: makeSource('v1') });
    writeFileSync(join(skillTarget(dshHome), 'stray.md'), 'stray');

    expect(installSkill({ dshHome, source: makeSource('v1') })).toEqual({ ok: true });
    expect(existsSync(join(skillTarget(dshHome), 'stray.md'))).toBe(false);
  });

  it('replaces a stale target', () => {
    const dshHome = tempDir();
    installSkill({ dshHome, source: makeSource('v1') });

    expect(installSkill({ dshHome, source: makeSource('v2') })).toEqual({ ok: true });
    expect(readFileSync(join(skillTarget(dshHome), 'SKILL.md'), 'utf8')).toBe('v2');
  });

  it('never clobbers a symlinked target (dev-flow ownership)', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    symlinkSync(source, skillTarget(dshHome));

    expect(installSkill({ dshHome, source })).toEqual({ ok: true });
    expect(lstatSync(skillTarget(dshHome)).isSymbolicLink()).toBe(true);
  });

  it('reports a missing source without throwing', () => {
    const dshHome = tempDir();
    const logs: string[] = [];
    const missing = join(tempDir(), 'not-there');

    expect(installSkill({ dshHome, source: missing, log: (m) => logs.push(m) })).toEqual({
      ok: false,
      reason: 'source missing',
    });
    expect(logs).toHaveLength(1);
    expect(existsSync(skillTarget(dshHome))).toBe(false);
  });

  it('defaults to one stderr line per failure', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(installSkill({ dshHome: tempDir(), source: join(tempDir(), 'not-there') })).toEqual({
      ok: false,
      reason: 'source missing',
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('reports an unwritable target without throwing', () => {
    const dshHome = tempDir();
    // `skills` as a FILE makes creating `skills/<name>` fail.
    writeFileSync(join(dshHome, 'skills'), 'not a directory');
    const logs: string[] = [];

    const result = installSkill({ dshHome, source: makeSource('v1'), log: (m) => logs.push(m) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(logs).toHaveLength(1);
  });
});

describe('installSkill link mode (dogfooding)', () => {
  it('links the target at the source', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');

    expect(installSkill({ dshHome, source, link: true })).toEqual({ ok: true });
    const target = skillTarget(dshHome);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(realpathSync(target)).toBe(realpathSync(source));
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('v1');
  });

  it('is idempotent: an existing correct link is left untouched', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    installSkill({ dshHome, source, link: true });
    const before = lstatSync(skillTarget(dshHome)).mtimeMs;

    expect(installSkill({ dshHome, source, link: true })).toEqual({ ok: true });
    expect(lstatSync(skillTarget(dshHome)).mtimeMs).toBe(before);
  });

  it('reads live worktree edits through the link without any sync', () => {
    const dshHome = tempDir();
    const source = makeSource('v1', { 'references/a.md': 'a1' });
    installSkill({ dshHome, source, link: true });

    writeFileSync(join(source, 'references/a.md'), 'a2');
    expect(readFileSync(join(skillTarget(dshHome), 'references/a.md'), 'utf8')).toBe('a2');
  });

  it('relinks a symlink that points elsewhere', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    const other = makeSource('v2');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    symlinkSync(other, skillTarget(dshHome));

    expect(installSkill({ dshHome, source, link: true })).toEqual({ ok: true });
    expect(realpathSync(skillTarget(dshHome))).toBe(realpathSync(source));
  });

  it('refuses to replace a real directory without force, and does not delete it', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    installSkill({ dshHome, source });
    const logs: string[] = [];

    expect(installSkill({ dshHome, source, link: true, log: (m) => logs.push(m) })).toEqual({
      ok: false,
      reason: 'target-exists',
    });
    expect(lstatSync(skillTarget(dshHome)).isSymbolicLink()).toBe(false);
    expect(logs.some((line) => line.includes('--force'))).toBe(true);
  });

  it('replaces a real directory when forced', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    installSkill({ dshHome, source });

    expect(installSkill({ dshHome, source, link: true, force: true })).toEqual({ ok: true });
    expect(lstatSync(skillTarget(dshHome)).isSymbolicLink()).toBe(true);
    expect(realpathSync(skillTarget(dshHome))).toBe(realpathSync(source));
  });
});

describe('skillInstallState', () => {
  it('reports a missing target as stale', () => {
    const source = makeSource('v1');

    expect(skillInstallState(source, skillTarget(tempDir()))).toBe('stale');
    expect(skillTargetsLink(source, skillTarget(tempDir()))).toBeUndefined();
  });

  it('reports a byte-identical copy', () => {
    const dshHome = tempDir();
    const source = makeSource('v1', { 'references/a.md': 'a1' });
    installSkill({ dshHome, source });

    expect(skillInstallState(source, skillTarget(dshHome))).toBe('identical');
  });

  it('reports a stale copy', () => {
    const dshHome = tempDir();
    installSkill({ dshHome, source: makeSource('v1') });

    expect(skillInstallState(makeSource('v2'), skillTarget(dshHome))).toBe('stale');
  });

  it('reports a link to the source', () => {
    const dshHome = tempDir();
    const source = makeSource('v1');
    installSkill({ dshHome, source, link: true });

    expect(skillInstallState(source, skillTarget(dshHome))).toBe('linked');
  });

  it('reports a symlink pointing elsewhere as stale', () => {
    const dshHome = tempDir();
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    symlinkSync(makeSource('v2'), skillTarget(dshHome));

    expect(skillInstallState(makeSource('v1'), skillTarget(dshHome))).toBe('stale');
  });
});
