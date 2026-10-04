/**
 * The `keyboard` submodule's host-face wiring.
 *
 * The behaviour lives in the browser half (`src/keyboard/client.ts`), which the
 * client module system loads whenever this package declares `dsh.client`. Two
 * facts shape this module:
 *
 * - **A client entry is not handed the mount line.** The shipped
 *   `@deepseek-ai/dsh-client-shortcuts` publishes its validated settings as a page
 *   global through `webserver/index-inject` for exactly that reason, and this
 *   module does the same for `keyboard.enabled`.
 * - **Registering the subscription costs nothing outside a web composition.**
 *   `ctx.on` needs no injection, and an event with no listeners is a no-op, so the
 *   plugin still loads in headless and CLI profiles.
 */

import type { DshContextLike } from '../uv/types.js';
import type { KeyboardConfig } from './config.js';

/** The page global the browser half reads its switch from. */
export const KEYBOARD_CONFIG_GLOBAL = '__DSH_DEV_DSH_KEYBOARD__';

/** The page-injection event a web server emits while rendering the index. */
export const INDEX_INJECT_EVENT = 'webserver/index-inject';

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

/** The context slice this submodule needs on top of the shared host slice. */
interface EventBusLike {
  on(event: string, listener: (table: InjectionTable) => void): unknown;
}

/**
 * Publish the `keyboard` submodule's switch to the pages this host serves.
 *
 * @param ctx - the plugin's root context.
 * @param config - the validated submodule config; a disabled submodule publishes nothing.
 * @param log - optional one-line sink; without one, a failure survives only in the outcome.
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
    const bus = asEventBus(ctx);
    if (bus === undefined) {
      log?.(KEYBOARD_NO_EVENT_BUS_NOTE);
      return { ok: false, reason: 'host context exposes no event bus' };
    }
    bus.on(INDEX_INJECT_EVENT, (table) => {
      table.push({ kind: 'global', name: KEYBOARD_CONFIG_GLOBAL, value: { enabled: true } });
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log?.(`[keyboard] 注入页面开关失败：${reason}`);
    return { ok: false, reason };
  }
  return { ok: true };
}

/** Narrow a context to one that can register the page-injection listener. */
function asEventBus(ctx: DshContextLike): EventBusLike | undefined {
  const on = (ctx as { on?: unknown }).on;
  return typeof on === 'function' ? (ctx as unknown as EventBusLike) : undefined;
}

/** Why the browser half does nothing today, and how to turn it on. */
export const KEYBOARD_DISABLED_NOTE =
  '[keyboard] 提示卡 Enter/↑↓ 补位未开启（keyboard.enabled: false）；' +
  '如需开启，在 profile 的 cordis.patch.yml 中为本插件加 `keyboard: { enabled: true }` 并重启 harness。';

/** The host context cannot publish a page global at all. */
export const KEYBOARD_NO_EVENT_BUS_NOTE =
  '[keyboard] 已开启，但当前宿主的 ctx 没有 `on`，无法把开关注入页面；浏览器半边会保持关闭。';
