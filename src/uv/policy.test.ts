import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  canonicalTarget,
  cwdEscape,
  dedupeMatches,
  findAskMatches,
  flagValue,
  isHelpOrVersion,
  isWithin,
  resolveUvCwd,
  stripUvPrefix,
} from './policy.js';

const CWD = '/workspace/project';
const OUTSIDE = '/workspace/other';

/** Ask-class ids matched by one invocation, for compact assertions. */
function ids(args: string[], cwd = CWD): string[] {
  return findAskMatches(args, cwd).map((match) => match.id);
}

describe('findAskMatches: risky classes', () => {
  it.each<[string[], string]>([
    [['self', 'update'], 'self-update'],
    [['cache', 'clean'], 'cache-clean'],
    [['cache', 'prune'], 'cache-prune'],
    [['python', 'install', '3.12'], 'python-install'],
    [['python', 'uninstall', '3.12'], 'python-uninstall'],
    [['tool', 'install', 'ruff'], 'tool-install'],
    [['tool', 'uninstall', 'ruff'], 'tool-uninstall'],
    [['tool', 'upgrade'], 'tool-upgrade'],
  ])('matches %j as %s', (args, id) => {
    expect(ids(args)).toEqual([id]);
  });

  it('matches bare publish and auth anywhere in argv', () => {
    expect(ids(['publish'])).toEqual(['publish']);
    expect(ids(['auth', 'login'])).toEqual(['auth']);
    expect(ids(['run', '--', 'auth'])).toEqual(['auth']);
  });

  it('matches uv pip writing outside the project environment', () => {
    expect(ids(['pip', 'install', '--system', 'ruff'])).toEqual(['pip-system']);
    expect(ids(['pip', 'install', '--python', `${OUTSIDE}/bin/python`, 'ruff'])).toEqual([
      `cwd-escape:${OUTSIDE}/bin/python`,
    ]);
  });

  it('leaves uv pip with a project-local interpreter alone', () => {
    expect(ids(['pip', 'install', '--python', `${CWD}/.venv/bin/python`, 'ruff'])).toEqual([]);
    expect(ids(['pip', 'install', '--python', '3.12', 'ruff'])).toEqual([]);
  });

  it('reports every matched class once', () => {
    expect(ids(['tool', 'install', 'ruff', '--cache-dir', OUTSIDE])).toEqual([
      'tool-install',
      `cwd-escape:${OUTSIDE}`,
    ]);
    expect(ids(['publish', 'publish'])).toEqual(['publish']);
  });

  it('tolerates a leading uv token the model added by habit', () => {
    expect(ids(['uv', 'cache', 'prune'])).toEqual(['cache-prune']);
  });
});

describe('findAskMatches: write targets outside the session directory', () => {
  it.each<[string]>([
    ['--directory'],
    ['--project'],
    ['--cache-dir'],
    ['--config-file'],
    ['--target'],
  ])('asks for %s with a path outside the session', (flag) => {
    expect(ids([flag, OUTSIDE, 'sync'])).toEqual([`cwd-escape:${OUTSIDE}`]);
  });

  it('accepts the --flag=value spelling', () => {
    expect(ids([`--directory=${OUTSIDE}`, 'sync'])).toEqual([`cwd-escape:${OUTSIDE}`]);
  });

  it('asks when a relative target resolves out of the session', () => {
    expect(ids(['--directory', '..', 'sync'])).toEqual(['cwd-escape:/workspace']);
  });

  it('leaves targets inside the session alone', () => {
    expect(ids(['--directory', 'sub/dir', 'sync'])).toEqual([]);
    expect(ids(['--cache-dir', `${CWD}/.uv-cache`, 'sync'])).toEqual([]);
  });
});

describe('findAskMatches: the allow-by-default stance', () => {
  it.each<[string[]]>([
    [['sync']],
    [['lock', '--check']],
    [['add', 'numpy']],
    [['remove', 'numpy']],
    [['run', 'pytest', '-q']],
    [['run', 'python', '-c', 'print("tool install")']],
    [['venv', '--python', '3.12']],
    [['build']],
    [['export', '--format', 'requirements-txt']],
    [['tree']],
    [['format', '--check']],
    [['check']],
    [['audit']],
    [['init']],
    [['version']],
    [['cache', 'dir']],
    [['cache', 'size']],
    [['python', 'find']],
    [['python', 'list']],
    [['tool', 'list']],
    [['tool', 'run', 'ruff', '--version']],
    [['workspace', 'list']],
    [['pip', 'install', '-e', '.']],
    [['pip', 'list']],
  ])('allows %j', (args) => {
    expect(ids(args)).toEqual([]);
  });

  it('does not scan text inside one argv token', () => {
    expect(ids(['run', 'python', '-c', 'import os; os.system("uv cache clean")'])).toEqual([]);
  });
});

describe('help and version invocations', () => {
  it('never asks for pure help or version output', () => {
    expect(ids(['publish', '--help'])).toEqual([]);
    expect(ids(['cache', 'prune', '-h'])).toEqual([]);
    expect(ids(['tool', 'install', '--version'])).toEqual([]);
    expect(ids(['self', 'update', '-V'])).toEqual([]);
    expect(ids(['help', 'publish'])).toEqual([]);
    expect(isHelpOrVersion(['publish', '--help'])).toBe(true);
    expect(isHelpOrVersion(['publish'])).toBe(false);
  });
});

describe('path helpers', () => {
  it('strips only a leading uv/uvx token', () => {
    expect(stripUvPrefix(['uv', 'sync'])).toEqual(['sync']);
    expect(stripUvPrefix(['uvx', 'ruff'])).toEqual(['ruff']);
    expect(stripUvPrefix(['sync', 'uv'])).toEqual(['sync', 'uv']);
  });

  it('reads flag values in both spellings', () => {
    expect(flagValue(['--directory', '/tmp'], '--directory')).toBe('/tmp');
    expect(flagValue(['--directory=/tmp'], '--directory')).toBe('/tmp');
    expect(flagValue(['sync'], '--directory')).toBeUndefined();
  });

  it('decides containment on canonical paths', () => {
    expect(isWithin(CWD, CWD)).toBe(true);
    expect(isWithin(CWD, `${CWD}/sub`)).toBe(true);
    expect(isWithin(CWD, OUTSIDE)).toBe(false);
    expect(isWithin(CWD, '/workspace/projectx')).toBe(false);
    expect(canonicalTarget('sub', CWD)).toBe(`${CWD}/sub`);
  });

  it('resolves the tool cwd argument against the session directory', () => {
    expect(resolveUvCwd(CWD, undefined)).toBe(CWD);
    expect(resolveUvCwd(CWD, '  ')).toBe(CWD);
    expect(resolveUvCwd(CWD, 'sub')).toBe(`${CWD}/sub`);
    expect(resolveUvCwd(CWD, OUTSIDE)).toBe(OUTSIDE);
  });

  it('flags a cwd argument outside the session directory', () => {
    expect(cwdEscape(`${CWD}/sub`, CWD)).toBeUndefined();
    expect(cwdEscape(OUTSIDE, CWD)?.id).toBe(`cwd-escape:${OUTSIDE}`);
  });

  it('keeps first occurrences when de-duplicating', () => {
    expect(
      dedupeMatches([
        { id: 'publish', reason: 'a' },
        { id: 'auth', reason: 'b' },
        { id: 'publish', reason: 'c' },
      ])
    ).toEqual([
      { id: 'publish', reason: 'a' },
      { id: 'auth', reason: 'b' },
    ]);
  });
});

describe('canonical containment against a real symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-uv-policy-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(workspace, 'escape'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('sees a symlink that leaves the workspace as outside', () => {
    expect(ids(['--directory', join(workspace, 'escape'), 'sync'], workspace)).toEqual([
      `cwd-escape:${outside}`,
    ]);
    expect(ids(['--directory', join(workspace, 'sub'), 'sync'], workspace)).toEqual([]);
  });
});
