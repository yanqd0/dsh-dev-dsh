#!/usr/bin/env node
// Build this package's browser half: `src/client-entry.ts` -> `dist/client.js`.
//
// The harness loads a client bundle as a classic script that registers a
// closure factory — `window.__ModuleLoader__.load({ id, factory })` — and
// resolves every external through the `require` handed to that factory (the
// official `packages/client/tsdown.client.ts` emits exactly this shape). That
// preset is not published, so the wrapper is written here; the browser half
// deliberately imports nothing, so the factory body is fully inlined and no
// module-table word is requested.
//
// A self-check fails the build rather than shipping a silently unloadable
// bundle: the artifact must carry the registration call, that exact id, and no
// ESM import or loader-level `require(` of its own.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Must equal the Loader row name in `cordis.patch.yml`. */
const MODULE_ID = '@yanqd0/dsh-dev-dsh';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'client-entry.ts');
const outfile = join(root, 'dist', 'client.js');

const banner =
  'window.__ModuleLoader__.load({\n' +
  `\tid: ${JSON.stringify(MODULE_ID)},\n` +
  '\tfactory: (require) => {\n' +
  '\t\tvar module = { exports: {} };\n' +
  '\t\tvar exports = module.exports;\n';
const footer =
  '\nexports.apply = apply;\nexports.inject = inject;\n' +
  '\n\t\treturn module.exports;\n\t}\n});\n';

try {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['es2022'],
    charset: 'utf8',
    sourcemap: false,
    legalComments: 'none',
    banner: { js: banner },
    footer: { js: footer },
  });
} catch (error) {
  console.error(`[build-client] esbuild failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const artifact = await readFile(outfile, 'utf8');
const problems = [];
if (!artifact.includes('window.__ModuleLoader__.load('))
  problems.push('missing the loader registration call');
if (!artifact.includes(JSON.stringify(MODULE_ID)))
  problems.push(`missing the module id ${MODULE_ID}`);
if (!artifact.includes('factory:')) problems.push('missing the closure factory');
if (!/^\s*exports\.apply\s*=/m.test(artifact)) problems.push('the factory does not expose `apply`');
if (!/^\s*exports\.inject\s*=/m.test(artifact))
  problems.push('the factory does not expose `inject`');
if (/^\s*(?:import|export)\s/m.test(artifact))
  problems.push('the bundle is an ES module, not a classic script');
if (problems.length > 0) {
  console.error(`[build-client] ${outfile} is not a loadable client bundle:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`[build-client] wrote ${outfile} for ${MODULE_ID} (${artifact.length} bytes)`);
