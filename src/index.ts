import { z } from 'zod';

import { installSkill } from './install-skill.js';

/**
 * dsh-dev-dsh — a DSH plugin for developing DSH plugins.
 *
 * This module is the host-face entry that `cordis.patch.yml` mounts. 0.1.0
 * carries no runtime tools or UI: the plugin exists to ship the out-of-tree
 * authoring skill and keep it installed (see `install-skill.ts`).
 */
export const name = 'dsh-dev-dsh';

export const Config = z.object({
  /**
   * Content-sync the skill bundled in this package into the DSH skill
   * directory on every plugin load. Default true — this is the path that still
   * works when a package manager blocks the `postinstall` script.
   */
  autoInstallSkill: z.boolean().default(true),
});

export type Config = z.infer<typeof Config>;

/**
 * cordis plugin entry. `ctx` is intentionally unused in 0.1.0: the plugin
 * consumes no host services.
 */
export function apply(_ctx: unknown, config: Config): void {
  if (config.autoInstallSkill) {
    installSkill();
  }
}
