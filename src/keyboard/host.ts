/**
 * The `keyboard` submodule's host-face wiring.
 *
 * The behaviour lives in the browser half (`src/keyboard/client.ts`), which the
 * client module system loads whenever this package declares `dsh.client`. Two
 * facts shape this module:
 *
 * - **The browser cannot read the mount line.** A client entry receives only the
 *   config the Loader happens to hand it, so the host publishes the validated
 *   switch as a page global through `webserver/index-inject` — exactly how
 *   `@deepseek-ai/dsh-client-shortcuts` publishes `__DSH_SHORTCUTS_CONFIG__`.
 * - **A missing web server is not an error.** Headless and CLI profiles have no
 *   page to patch; the submodule then wires nothing and the plugin still loads.
 */

import type { DshContextLike } from '../uv/types.js';
import type { KeyboardConfig } from './config.js';

/** The page global the browser half reads its switch from. */
export const KEYBOARD_CONFIG_GLOBAL = '__DSH_DEV_DSH_KEYBOARD__';

/** One page-injection row, as `webserver/index-inject` subscribers push it. */
export interface IndexInjectionRow {
  kind: 'global';
  name: string;
  value: unknown;
}

/** Outcome of the wiring step (observable in tests). */
export interface KeyboardInstallOutcome {
  ok: boolean;
  reason?: string | undefined;
}

/** The injection table a web server hands to every subscriber. */
type InjectionTable = IndexInjectionRow[];

/** The optional web-server slice this submodule subscribes to. */
interface IndexInjectorLike {
  on(event: 'webserver/index-inject', listener: (table: InjectionTable) => void): unknown;
}

/**
 * Publish the `keyboard` submodule's switch to the pages this host serves.
 *
 * @param ctx - the plugin's root context.
 * @param config - the validated submodule config; a disabled submodule publishes nothing.
 * @param log - one-line sink used to report the disabled state to the host log.
 * @returns the wiring outcome; it never throws.
 */
export function installKeyboard(
  ctx: DshContextLike,
  config: KeyboardConfig,
  log?: (message: string) => void
): KeyboardInstallOutcome {
  if (!config.enabled) {
    log?.(KEYBOARD_DISABLED_NOTE);
    return { ok: true, reason: 'disabled' };
  }
  try {
    const injector = asIndexInjector(ctx.get('webserver'));
    if (injector === undefined) {
      return { ok: false, reason: 'no webserver in this composition' };
    }
    injector.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: KEYBOARD_CONFIG_GLOBAL, value: { enabled: true } });
    });
  } catch (error) {
    // Wiring itself failed (not a service outage): report, never break load.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/** Narrow an optional service to the index-injection slice this submodule uses. */
function asIndexInjector(value: unknown): IndexInjectorLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return typeof (value as { on?: unknown }).on === 'function'
    ? (value as IndexInjectorLike)
    : undefined;
}

/** Why the browser half does nothing today, and how to turn it on. */
export const KEYBOARD_DISABLED_NOTE =
  '[keyboard] 提示卡 Enter/↑↓ 补位未开启（keyboard.enabled: false）；' +
  '如需开启，在 profile 的 cordis.patch.yml 中为本插件加 `keyboard: { enabled: true }` 并重启 harness。';
