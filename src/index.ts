import { z } from 'zod';

import { installSkill } from './install-skill.js';
import { UvConfigSchema } from './uv/config.js';
import { installUv } from './uv/index.js';
import type { DshContextLike } from './uv/types.js';

/**
 * dsh-dev-dsh — a DSH plugin for developing DSH plugins.
 *
 * This module is the host-face entry that `cordis.patch.yml` mounts. Its core
 * deliverable stays the out-of-tree authoring skill (shipped and kept installed
 * by `install-skill.ts`); the optional `uv` submodule is the first of the
 * deliberately experimental modules this repository carries for its own
 * dogfooding (see `notes/uv.md`). Submodules are opt-in: a deployment that does
 * nothing new gets exactly the 0.1.0 behaviour.
 */
export const name = 'dsh-dev-dsh';

export const Config = z.object({
  /**
   * Content-sync the skill bundled in this package into the DSH skill
   * directory on every plugin load. Default true — this is the path that still
   * works when a package manager blocks the `postinstall` script.
   */
  autoInstallSkill: z.boolean().default(true),
  /**
   * Experimental submodule #1: the host `uv` tool (`src/uv/`). Default:
   * disabled, because that tool runs uv outside the session file sandbox — an
   * explicit deployment choice, made in the profile's `cordis.patch.yml`
   * override for this plugin.
   */
  uv: UvConfigSchema.default({}),
});

export type Config = z.infer<typeof Config>;

/**
 * cordis plugin entry. Never throws: a failing submodule reports itself and
 * leaves the rest of the plugin (the skill sync) working.
 */
export function apply(ctx: DshContextLike, config: Config): void {
  if (config.autoInstallSkill) {
    installSkill();
  }
  installUv(ctx, config.uv);
}
