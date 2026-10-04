/**
 * The `keyboard` submodule's host-face wiring.
 *
 * The behaviour lives in the browser half (`src/keyboard/client.ts`), which the
 * client module system loads whenever this package declares `dsh.client` —
 * there is no host-side route to enable or disable it per session, and the
 * authority for the switch is the profile patch's last-wins override of this
 * plugin's `config`. This module therefore only records the decision: a disabled
 * submodule wires nothing and never fails the plugin load.
 */

import type { KeyboardConfig } from './config.js';

/** Outcome of the wiring step (observable in tests). */
export interface KeyboardInstallOutcome {
  ok: boolean;
  reason?: string | undefined;
}

/**
 * Record the `keyboard` submodule's state for one host context.
 *
 * @param config - the submodule config; a disabled submodule wires nothing.
 * @param log - one-line sink used to report the disabled state to the host log.
 * @returns the wiring outcome; it never throws.
 */
export function installKeyboard(
  config: KeyboardConfig,
  log?: (message: string) => void
): KeyboardInstallOutcome {
  if (!config.enabled) {
    log?.(KEYBOARD_DISABLED_NOTE);
    return { ok: true, reason: 'disabled' };
  }
  // Enabled: the browser half is already part of this package's client bundle,
  // so there is nothing left to install on the host face.
  return { ok: true };
}

/** Why the browser half does nothing today, and how to turn it on. */
export const KEYBOARD_DISABLED_NOTE =
  '[keyboard] 提示卡 Enter/↑↓ 补位未开启（keyboard.enabled: false）；' +
  '如需开启，在 profile 的 cordis.patch.yml 中为本插件加 `keyboard: { enabled: true }` 并重启 harness。';
