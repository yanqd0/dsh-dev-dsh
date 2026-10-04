import { describe, expect, it, vi } from 'vitest';

import {
  INDEX_INJECT_EVENT,
  KEYBOARD_CONFIG_GLOBAL,
  KEYBOARD_DISABLED_NOTE,
  KEYBOARD_NO_EVENT_BUS_NOTE,
  installKeyboard,
} from './host.ts';
import type { IndexInjectionRow } from './host.ts';
import type { DshContextLike } from '../uv/types.ts';

/** A host context that records the events this submodule subscribes to. */
function hostContext(options: { withBus?: boolean } = {}): {
  ctx: DshContextLike;
  emit: (event: string) => IndexInjectionRow[];
  subscribed: string[];
} {
  const listeners = new Map<string, ((table: IndexInjectionRow[]) => void)[]>();
  const subscribed: string[] = [];
  const ctx = {
    get: () => undefined,
    inject: () => undefined,
    ...(options.withBus === false
      ? {}
      : {
          on: (event: string, listener: (table: IndexInjectionRow[]) => void) => {
            subscribed.push(event);
            const current = listeners.get(event);
            if (current === undefined) listeners.set(event, [listener]);
            else current.push(listener);
            return undefined;
          },
        }),
  } as DshContextLike;
  return {
    ctx,
    subscribed,
    emit: (event) => {
      const table: IndexInjectionRow[] = [];
      for (const listener of listeners.get(event) ?? []) listener(table);
      return table;
    },
  };
}

/** A context whose `on` throws, standing in for a broken subscription. */
function throwingContext(): DshContextLike {
  return {
    get: () => undefined,
    inject: () => undefined,
    on: () => {
      throw new Error('subscribe refused');
    },
  } as unknown as DshContextLike;
}

describe('keyboard submodule host wiring', () => {
  it('wires nothing and reports the disabled state', () => {
    const log = vi.fn();
    const fake = hostContext();
    expect(installKeyboard(fake.ctx, { enabled: false }, log)).toEqual({
      ok: true,
      reason: 'disabled',
    });
    expect(log).toHaveBeenCalledWith(KEYBOARD_DISABLED_NOTE);
    expect(fake.subscribed).toEqual([]);
  });

  it('publishes the switch on every index render when the profile enables it', () => {
    const log = vi.fn();
    const fake = hostContext();
    expect(installKeyboard(fake.ctx, { enabled: true }, log)).toEqual({ ok: true });
    expect(log).not.toHaveBeenCalled();
    expect(fake.subscribed).toEqual([INDEX_INJECT_EVENT]);
    expect(fake.emit(INDEX_INJECT_EVENT)).toEqual([
      { kind: 'global', name: KEYBOARD_CONFIG_GLOBAL, value: { enabled: true } },
    ]);
  });

  it('subscribes without needing any service in the composition', () => {
    // The subscription is an event listener: no `inject`, no service lookup, so a
    // headless host that never serves a page simply never emits it.
    const fake = hostContext();
    expect(installKeyboard(fake.ctx, { enabled: true })).toEqual({ ok: true });
    expect(fake.emit('some/other-event')).toEqual([]);
  });

  it('reports a context without an event bus', () => {
    const log = vi.fn();
    const outcome = installKeyboard(hostContext({ withBus: false }).ctx, { enabled: true }, log);
    expect(outcome).toEqual({ ok: false, reason: 'host context exposes no event bus' });
    expect(log).toHaveBeenCalledWith(KEYBOARD_NO_EVENT_BUS_NOTE);
  });

  it('reports a failing subscription instead of throwing', () => {
    expect(installKeyboard(throwingContext(), { enabled: true })).toEqual({
      ok: false,
      reason: 'subscribe refused',
    });
  });
});
