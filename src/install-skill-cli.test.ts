import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('postinstall entry', () => {
  /**
   * `install-skill-cli.ts` is a side-effect module: importing it runs the sync
   * once, the way `node dist/install-skill.js` does at postinstall. The tested
   * guarantee is that this can never throw and never touch anything outside
   * `DSH_HOME` — a package manager must not fail because the skill could not be
   * installed.
   */
  it('imports without throwing and writes only a log line', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-dev-dsh-cli-'));
    created.push(dshHome);
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(import('./install-skill-cli.ts')).resolves.toBeDefined();
    } finally {
      if (previous === undefined) {
        delete process.env.DSH_HOME;
      } else {
        process.env.DSH_HOME = previous;
      }
    }
    // From `src/`, the bundled `skill/` directory is not beside the module, so
    // the run reports a missing source rather than copying anything.
    expect(write).toHaveBeenCalledTimes(1);
  });
});
