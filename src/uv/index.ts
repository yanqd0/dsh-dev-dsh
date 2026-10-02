/**
 * The `uv` submodule's host-face wiring.
 *
 * `installUv` is called from the plugin's `apply()` and adds the tool only when
 * the mount line enables it. Both dependencies are requested through scoped
 * `ctx.inject` rather than a module-level `inject`: the package's core
 * deliverable (the skill sync) must keep loading in compositions that mount
 * neither `tools` nor `subprocess`, and an injected scope that never activates
 * is a silent no-op instead of a load failure.
 */

import { installUvTool, UV_GUIDANCE_ORDER, UV_TOOL_GUIDANCE } from './tool.js';
import type { UvConfig } from './config.js';
import type { DshContextLike, SystemPromptLike } from './types.js';

/** Outcome of the wiring step (the tool's own result is reported per scope). */
export interface UvInstallOutcome {
  ok: boolean;
  reason?: string | undefined;
}

/**
 * Wire the `uv` submodule into one host context.
 *
 * @param ctx - the plugin's root context.
 * @param config - the submodule config; a disabled submodule wires nothing.
 * @param log - one-line failure sink, forwarded to the tool installation.
 * @returns the wiring outcome; it never throws.
 */
export function installUv(
  ctx: DshContextLike,
  config: UvConfig,
  log?: (message: string) => void
): UvInstallOutcome {
  if (!config.enabled) {
    return { ok: true, reason: 'disabled' };
  }
  try {
    ctx.inject(['tools', 'subprocess'], (scope) => {
      installUvTool(scope, config, log);
    });
    ctx.inject(['systemPrompt'], (scope) => {
      installUvGuidance(scope);
    });
  } catch (error) {
    // Wiring itself failed (not a service outage): report, never break load.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/**
 * Add the one-line tool-first guidance.
 *
 * `section` is preferred (it belongs to the stable system-prompt prefix, so it
 * does not invalidate the cached prefix per request); leaner hosts that only
 * expose `context` fall back to it.
 *
 * @param scope - a context whose `systemPrompt` service is active.
 */
export function installUvGuidance(scope: DshContextLike): void {
  const systemPrompt = scope.get('systemPrompt');
  const service = asSystemPrompt(systemPrompt);
  if (service === undefined) {
    return;
  }
  const spec = { name: 'uv:tool-first', order: UV_GUIDANCE_ORDER, text: UV_TOOL_GUIDANCE };
  if (typeof service.section === 'function') {
    service.section(spec);
    return;
  }
  service.context(spec);
}

/** Narrow an unknown value to the `systemPrompt` slice this submodule uses. */
function asSystemPrompt(value: unknown): SystemPromptLike | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.context === 'function' ? (value as SystemPromptLike) : undefined;
}
