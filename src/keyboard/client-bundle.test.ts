// @vitest-environment jsdom
/**
 * End-to-end check of the built browser artifact.
 *
 * The unit specs drive `src/keyboard/` directly; this one runs the *served*
 * bundle (`dist/client.js`) the way a page does: a classic script that reads
 * `window.__ModuleLoader__.load`, with `globalThis` bound to the page's global
 * object — which is where the host injects the switch, and the only channel a
 * browser half has for the mount line. It therefore covers the loader contract
 * (registration id, `apply` / `inject` exports) and the published-global path
 * against real artifact bytes.
 *
 * It self-skips when `dist/` is absent: `pnpm test` must not require a build.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ARTIFACT = join(process.cwd(), 'dist', 'client.js');
const MODULE_ID = '@yanqd0/dsh-dev-dsh';
const SWITCH_GLOBAL = '__DSH_DEV_DSH_KEYBOARD__';

/** One registered bundle factory, as the bundle hands it to the loader. */
type Registration = {
  id: string;
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>;
};

/** Whether the artifact exists; `dist/` is a build output, not a test prerequisite. */
function artifactBuilt(): boolean {
  return existsSync(ARTIFACT);
}

/**
 * Evaluate the artifact the way a page does: a classic script whose `globalThis`
 * is the page's global object.
 *
 * The page global is this realm's `globalThis`, so the artifact is executed in
 * the current context rather than in a fresh one.
 *
 * @param pageWindow - the `window` facade the artifact registers through.
 * @returns the single registration the artifact submitted.
 */
function runBundle(pageWindow: Record<string, unknown>): Registration {
  const registrations: Registration[] = [];
  const host = globalThis as { window?: unknown };
  const previous = host.window;
  host.window = {
    ...pageWindow,
    __ModuleLoader__: {
      load: (entry: Registration) => {
        registrations.push(entry);
      },
    },
  };
  try {
    runInThisContext(readFileSync(ARTIFACT, 'utf8'));
  } finally {
    if (previous === undefined) delete host.window;
    else host.window = previous;
  }
  expect(registrations).toHaveLength(1);
  return registrations[0] as Registration;
}

describe('shipped client bundle', () => {
  it('registers itself under the id the profile mounts', () => {
    if (!artifactBuilt()) return;
    expect(runBundle({}).id).toBe(MODULE_ID);
  });

  it('wires the keyboard half from the published switch global', () => {
    if (!artifactBuilt()) return;
    const exports = runBundle({}).factory(() => {
      throw new Error('the keyboard half must not require a module-table word');
    });
    expect(exports['inject']).toEqual(['shortcuts']);
    const apply = exports['apply'];
    expect(typeof apply).toBe('function');
    const effects: (() => () => void)[] = [];
    const listener = vi.fn();
    const registered: string[] = [];
    const shortcuts = {
      observeFixedInput: listener,
      registerFixed: (command: { id: string }) => {
        registered.push(command.id);
        return () => {};
      },
    };
    const scope = {
      // The page's window is the realm global, not a service.
      get: (name: string) => (name === 'window' ? globalThis : shortcuts),
      inject: () => undefined,
      effect: (callback: () => () => void) => {
        effects.push(callback);
        return undefined;
      },
    };
    const ctx = {
      get: () => undefined,
      inject: (services: readonly string[], callback: (value: unknown) => void) => {
        expect(services).toEqual(['shortcuts']);
        callback(scope);
        return undefined;
      },
      effect: () => undefined,
    };
    if (typeof apply === 'function') {
      (globalThis as Record<string, unknown>)[SWITCH_GLOBAL] = { enabled: true };
      try {
        (apply as (ctx: unknown, cfg: Record<string, unknown>) => void)(ctx, {});
      } finally {
        delete (globalThis as Record<string, unknown>)[SWITCH_GLOBAL];
      }
    }
    expect(effects).toHaveLength(1);
    effects[0]?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registered).toEqual(['approval.allow']);
  });

  it('stays inert while the mount line leaves the submodule disabled', () => {
    if (!artifactBuilt()) return;
    const exports = runBundle({}).factory(() => undefined);
    const apply = exports['apply'] as (ctx: unknown, cfg: Record<string, unknown>) => void;
    const inject = vi.fn();
    apply({ get: () => undefined, inject, effect: () => undefined }, {});
    expect(inject).not.toHaveBeenCalled();
  });
});
