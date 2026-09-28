import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  skillSource,
  skillTarget,
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
