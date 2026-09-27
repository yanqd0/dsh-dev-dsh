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
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SKILL_NAME, installSkill, resolveDshHome, skillTarget } from './install-skill.ts';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-dsh-test-'));
  created.push(dir);
  return dir;
}

/** Build a fake bundled-skill source directory containing one SKILL.md. */
function makeSource(body = 'body'): string {
  const source = join(tempDir(), 'skill');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), body);
  return source;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
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
    const source = makeSource('v1');
    installSkill({ dshHome, source });
    const before = statSync(skillTarget(dshHome)).mtimeMs;

    expect(installSkill({ dshHome, source })).toEqual({ ok: true });
    expect(statSync(skillTarget(dshHome)).mtimeMs).toBe(before);
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
