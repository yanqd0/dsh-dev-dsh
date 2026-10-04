/**
 * Browser-half entry for `@yanqd0/dsh-dev-dsh`.
 *
 * This module is the payload of the client bundle. It is an ordinary cordis
 * plugin module (`inject` + `apply`); `scripts/build-client.mjs` wraps its
 * compiled output in the closure factory the client module system expects
 * (`window.__ModuleLoader__.load({ id, factory })`, the shape the official
 * `packages/client/tsdown.client.ts` preset emits), so nothing in here knows
 * about the loader facade or the bundle's file name.
 *
 * The switch reaches this half through a page global: the Loader does not hand a
 * client entry the plugin's mount-line config (the shipped
 * `@deepseek-ai/dsh-client-shortcuts` reads `__DSH_SHORTCUTS_CONFIG__` the same
 * way), so `src/keyboard/host.ts` publishes the validated value under
 * {@link KEYBOARD_CONFIG_GLOBAL}. The Loader-supplied `config` stays as the
 * fallback for a composition that passes it, and for tests.
 */

import { installKeyboardClient } from './keyboard/client.js';
import type { ClientContextLike } from './keyboard/types.js';

/** The page global the host publishes the validated switch through. */
export const KEYBOARD_CONFIG_GLOBAL = '__DSH_DEV_DSH_KEYBOARD__';

/** Narrow one candidate config value to this submodule's switch. */
function enabledIn(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { enabled?: unknown }).enabled === true;
}

/**
 * Whether the mount line enabled the submodule.
 *
 * @param cfg - the config the Loader passed for this row, when it passed one.
 * @returns `true` only for an explicit `enabled: true`, from the page global or
 *   from that config.
 */
export function keyboardEnabled(cfg: Record<string, unknown>): boolean {
  const published = (globalThis as Record<string, unknown>)[KEYBOARD_CONFIG_GLOBAL];
  if (enabledIn(published)) return true;
  return enabledIn(cfg['keyboard']);
}

/**
 * cordis client plugin entry.
 *
 * @param ctx - plugin-owned client context.
 * @param cfg - the `config` object the Loader passes for this row.
 * @returns the installation outcome, forwarded for tests.
 */
export function apply(ctx: ClientContextLike, cfg: Record<string, unknown> = {}) {
  return installKeyboardClient(ctx, { enabled: keyboardEnabled(cfg) });
}

/** The cordis service this plugin needs before it activates. */
export const inject = ['shortcuts'];
