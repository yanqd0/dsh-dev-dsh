/**
 * Mount-line configuration for the `uv` submodule.
 *
 * Kept in its own module so the submodule stays extractable as a standalone
 * plugin later: `src/index.ts` only composes this schema and calls
 * {@link import('./index.js').installUv}.
 */

import { z } from 'zod';

/** The `uv` submodule's config block. */
export const UvConfigSchema = z.object({
  /**
   * Register the `uv` tool. Default false: the tool runs uv outside the session
   * file sandbox, so enabling it is an explicit deployment choice — set it in
   * the profile's `cordis.patch.yml` override for `dsh-dev-dsh`.
   */
  enabled: z.boolean().default(false),
  /**
   * The uv executable: a bare command name resolved on the child's `PATH`, an
   * absolute path, or a `~`-prefixed path. Default: `uv` on `PATH`.
   */
  entry: z.string().optional(),
  /** Wall-clock limit for one call (milliseconds). */
  timeoutMs: z.number().int().positive().default(600_000),
  /** Ceiling for a per-call `timeoutMs` argument (milliseconds). */
  maxTimeoutMs: z.number().int().positive().default(3_600_000),
  /** In-memory tail kept per stream (bytes); overflow is reported with a spill path. */
  maxOutputBytes: z.number().int().positive().default(65_536),
  /** Whole-stream spill cap per stream (bytes). */
  maxSpillBytes: z.number().int().positive().default(16_777_216),
  /**
   * Skip the approval asks entirely — an explicit trust switch for the few
   * risky classes. Default false: the first risky call per session asks, the
   * rest of that class do not (`grant`).
   */
  autoApprove: z.boolean().default(false),
  /** Consent memory: `session` asks once per class per session; `call` always asks. */
  grant: z.enum(['session', 'call']).default('session'),
  /**
   * Ambient environment names forwarded past the subprocess credential scrub
   * (e.g. `UV_INDEX_URL`, `UV_GITHUB_TOKEN`). `HOME` and proxy variables already
   * survive, so the uv config file and mirrors keep working without this.
   */
  passEnv: z.array(z.string()).default([]),
  /** Explicit child environment entries, merged after `passEnv`. */
  env: z.record(z.string()).default({}),
});

export type UvConfig = z.infer<typeof UvConfigSchema>;
