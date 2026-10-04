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
 * A foreign config contradicts `src/keyboard/client.ts`'s declared
 * `KeyboardConfig`, and that contradiction is resolved on purpose: the browser
 * cannot read the mount line, so `keyboard.enabled` is enforced by this half
 * alone (see `src/keyboard/host.ts`).
 */

import { installKeyboardClient } from './keyboard/client.js';
import type { ClientContextLike } from './keyboard/types.js';

/** Narrow the Loader-supplied plugin config to this submodule's switch. */
export function keyboardEnabled(cfg: Record<string, unknown>): boolean {
  const keyboard = cfg['keyboard'];
  if (typeof keyboard !== 'object' || keyboard === null) return false;
  return (keyboard as { enabled?: unknown }).enabled === true;
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
