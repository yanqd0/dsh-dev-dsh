/**
 * Switch resolution for the browser half.
 *
 * The unit specs for `src/keyboard/` drive the key handling; this one covers the
 * gate in front of it — which is where a wrong channel silently disables the
 * whole submodule (a client entry is not handed the mount line).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { KEYBOARD_CONFIG_GLOBAL, apply, inject, keyboardEnabled } from './client-entry.ts';

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[KEYBOARD_CONFIG_GLOBAL];
});

describe('browser-half switch', () => {
  it('needs the shortcut service and nothing else', () => {
    expect(inject).toEqual(['shortcuts']);
  });

  it('reads the switch the host published to the page', () => {
    (globalThis as Record<string, unknown>)[KEYBOARD_CONFIG_GLOBAL] = { enabled: true };
    expect(keyboardEnabled({})).toBe(true);
  });

  it('falls back to the config a Loader may hand a client entry', () => {
    expect(keyboardEnabled({ keyboard: { enabled: true } })).toBe(true);
  });

  it('stays off for anything but an explicit true', () => {
    (globalThis as Record<string, unknown>)[KEYBOARD_CONFIG_GLOBAL] = { enabled: false };
    expect(keyboardEnabled({})).toBe(false);
    expect(keyboardEnabled({ keyboard: { enabled: 'yes' } })).toBe(false);
    expect(keyboardEnabled({ keyboard: null })).toBe(false);
    delete (globalThis as Record<string, unknown>)[KEYBOARD_CONFIG_GLOBAL];
    expect(keyboardEnabled({})).toBe(false);
  });

  it('wires nothing while disabled, whatever the Loader passes', () => {
    const calls: string[] = [];
    const ctx = {
      get: () => undefined,
      inject: () => {
        calls.push('inject');
        return undefined;
      },
      effect: () => undefined,
    };
    expect(apply(ctx)).toEqual({ ok: true, reason: 'disabled' });
    expect(calls).toEqual([]);
  });
});
