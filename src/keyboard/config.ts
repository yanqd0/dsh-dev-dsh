/**
 * Mount-line configuration for the `keyboard` submodule.
 *
 * Kept in its own module so the submodule stays extractable as a standalone
 * plugin later: `src/index.ts` only composes this schema and calls
 * {@link import('./host.js').installKeyboard}.
 */

import { z } from 'zod';

/** The `keyboard` submodule's config block. */
export const KeyboardConfigSchema = z
  .object({
    /**
     * Serve and use the browser keyboard half. Default false: it changes the
     * meaning of Enter and the arrow keys inside every prompt card, so enabling
     * it is an explicit deployment choice — set it in the profile's
     * `cordis.patch.yml` override for `dsh-dev-dsh` and restart the harness.
     */
    enabled: z.boolean().default(false),
  })
  .strict();

export type KeyboardConfig = z.infer<typeof KeyboardConfigSchema>;
