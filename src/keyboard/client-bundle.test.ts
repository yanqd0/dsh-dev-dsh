// @vitest-environment jsdom
/**
 * End-to-end check of the built browser artifact.
 *
 * The unit specs drive `src/keyboard/` directly; this one runs the *served*
 * bundle (`dist/client.js`) through a stub of the page's module-loader facade,
 * so the loader contract the harness actually consumes — the
 * `window.__ModuleLoader__.load({ id, factory })` registration, the id matching
 * the shipped row name, and the factory's `apply` / `inject` exports — is
 * verified against real artifact bytes.
 *
 * It self-skips when `dist/` is absent: `pnpm test` must not require a build.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ARTIFACT = join(process.cwd(), 'dist', 'client.js');
const MODULE_ID = '@yanqd0/dsh-dev-dsh';

/** One registered bundle factory, as the bundle hands it to the loader. */
type Registration = {
  id: string;
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>;
};

/** The bundle's registration, or `undefined` when the artifact is not built. */
async function loadArtifact(): Promise<Registration | undefined> {
  let code: string;
  try {
    code = await readFile(ARTIFACT, 'utf8');
  } catch {
    return undefined;
  }
  const registrations: Registration[] = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (entry: Registration) => {
          registrations.push(entry);
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  expect(registrations).toHaveLength(1);
  return registrations[0];
}

describe('shipped client bundle', () => {
  it('registers itself under the id the profile mounts', async () => {
    const registration = await loadArtifact();
    if (registration === undefined) return; // dist/ is a build output, not a test prerequisite
    expect(registration.id).toBe(MODULE_ID);
  });

  it('exports the cordis plugin and wires the keyboard half when enabled', async () => {
    const registration = await loadArtifact();
    if (registration === undefined) return;
    const exports = registration.factory(() => {
      throw new Error('the keyboard half must not require a module-table word');
    });
    expect(exports['inject']).toEqual(['shortcuts']);
    const apply = exports['apply'];
    expect(typeof apply).toBe('function');
    if (typeof apply !== 'function') return;
    const effects: (() => () => void)[] = [];
    const listener = vi.fn();
    const registered: string[] = [];
    const scope = {
      get: (name: string) =>
        name === 'window'
          ? globalThis
          : {
              observeFixedInput: listener,
              registerFixed: (command: { id: string }) => {
                registered.push(command.id);
                return () => {};
              },
            },
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
    (apply as (ctx: unknown, cfg: Record<string, unknown>) => void)(ctx, {
      keyboard: { enabled: true },
    });
    expect(effects).toHaveLength(1);
    effects[0]?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registered).toEqual(['approval.allow']);
  });

  it('stays inert while the mount line leaves the submodule disabled', async () => {
    const registration = await loadArtifact();
    if (registration === undefined) return;
    const exports = registration.factory(() => undefined);
    const apply = exports['apply'] as (ctx: unknown, cfg: Record<string, unknown>) => void;
    const inject = vi.fn();
    apply({ get: () => undefined, inject, effect: () => undefined }, {});
    expect(inject).not.toHaveBeenCalled();
  });
});
