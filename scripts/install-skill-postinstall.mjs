// postinstall guard: `pnpm install` may run before this package is built (fresh
// CI checkout), in which case `dist/install-skill.js` does not exist yet —
// importing the built entry directly would fail the install with
// MODULE_NOT_FOUND. This guard imports it only when present and swallows any
// failure: the skill install is best-effort here, and the runtime sync in the
// host plugin's `apply()` is the guaranteed path. Top-level await gives the
// import's rejection handler a chance to run.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'install-skill.js');

if (existsSync(entry)) {
  try {
    await import(pathToFileURL(entry).href);
  } catch (error) {
    process.stderr.write(
      `[dsh-dev-dsh] skill install failed: ${error?.message ?? String(error)}\n`
    );
  }
}
