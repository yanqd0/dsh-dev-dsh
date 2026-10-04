import { describe, expect, it, vi } from 'vitest';

import { KEYBOARD_CONFIG_GLOBAL, KEYBOARD_DISABLED_NOTE, installKeyboard } from './host.ts';
import type { IndexInjectionRow } from './host.ts';
import type { DshContextLike } from '../uv/types.ts';

/** A host context whose `get` returns the named optional services. */
function hostContext(services: Record<string, unknown> = {}): DshContextLike {
  return {
    get: (name) => services[name],
    inject: () => undefined,
  };
}

/** A stand-in web server recording `webserver/index-inject` subscribers. */
function webServer(): {
  service: { on: (event: string, listener: (table: IndexInjectionRow[]) => void) => void };
  emit: () => IndexInjectionRow[];
} {
  const listeners: ((table: IndexInjectionRow[]) => void)[] = [];
  return {
    service: {
      on: (event, listener) => {
        expect(event).toBe('webserver/index-inject');
        listeners.push(listener);
      },
    },
    emit: () => {
      const table: IndexInjectionRow[] = [];
      for (const listener of listeners) listener(table);
      return table;
    },
  };
}

describe('keyboard submodule host wiring', () => {
  it('wires nothing and reports the disabled state', () => {
    const log = vi.fn();
    expect(installKeyboard(hostContext(), { enabled: false }, log)).toEqual({
      ok: true,
      reason: 'disabled',
    });
    expect(log).toHaveBeenCalledWith(KEYBOARD_DISABLED_NOTE);
  });

  it('publishes the switch as a page global when the profile enables it', () => {
    const log = vi.fn();
    const server = webServer();
    const outcome = installKeyboard(
      hostContext({ webserver: server.service }),
      { enabled: true },
      log
    );
    expect(outcome).toEqual({ ok: true });
    expect(log).not.toHaveBeenCalled();
    expect(server.emit()).toEqual([
      { kind: 'global', name: KEYBOARD_CONFIG_GLOBAL, value: { enabled: true } },
    ]);
  });

  it('reports a composition with no web server without failing the load', () => {
    expect(installKeyboard(hostContext(), { enabled: true })).toEqual({
      ok: false,
      reason: 'no webserver in this composition',
    });
  });

  it('reports a failing subscription instead of throwing', () => {
    const service = {
      on: () => {
        throw new Error('subscribe refused');
      },
    };
    expect(installKeyboard(hostContext({ webserver: service }), { enabled: true })).toEqual({
      ok: false,
      reason: 'subscribe refused',
    });
  });
});
