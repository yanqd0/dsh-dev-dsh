import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_UV_ENTRY,
  UV_ENTRY_HINT,
  expandUvEntry,
  looksLikePath,
  resolveUvCommand,
} from './entry.js';

describe('resolveUvCommand', () => {
  it('defaults to the PATH command when the knob is absent or blank', () => {
    expect(resolveUvCommand(undefined)).toBe(DEFAULT_UV_ENTRY);
    expect(resolveUvCommand('   ')).toBe(DEFAULT_UV_ENTRY);
  });

  it('keeps a bare command name for PATH resolution', () => {
    expect(resolveUvCommand('uvx')).toBe('uvx');
  });

  it('expands a leading ~ a YAML value never gets from a shell', () => {
    expect(expandUvEntry('~')).toBe(homedir());
    expect(expandUvEntry('~/bin/uv')).toBe(join(homedir(), 'bin/uv'));
    expect(expandUvEntry('/usr/local/bin/uv')).toBe('/usr/local/bin/uv');
    expect(resolveUvCommand('~/bin/uv', () => true)).toBe(join(homedir(), 'bin/uv'));
  });

  it('treats a backslash-prefixed home shorthand like the POSIX one', () => {
    expect(expandUvEntry('~\\uv.exe')).toBe(join(homedir(), 'uv.exe'));
  });

  it('fails loud when a path-shaped entry is missing', () => {
    expect(() => resolveUvCommand('/nope/uv', () => false)).toThrow(UV_ENTRY_HINT);
    expect(resolveUvCommand('/opt/uv', () => true)).toBe('/opt/uv');
  });

  it('classifies path-shaped entries', () => {
    expect(looksLikePath('/abs/uv')).toBe(true);
    expect(looksLikePath('C:\\bin\\uv.exe')).toBe(true);
    expect(looksLikePath('uv')).toBe(false);
  });
});
