# Contributing to dsh-dev-dsh

This is the human development guide. For install, usage and options see the
[README](README.md); for the project map and the invariants a change has to respect see
[AGENTS.md](AGENTS.md). This file does not restate those.

## Background and status

dsh already ships capable authoring support for the _in-profile_ case: Creator mode (the `cordis`
agent preset) carries the `cordis-plugin-development` skill with templates, the `cordis_inspect_*`
runtime probes, and `plugin_manager`. Those cover "write a small plugin that installs into my
running profile".

They do not cover the out-of-tree engineering path, and the harness leaves that path to third
parties by design: its own project-scaffolding toolchain was removed, its shared client build preset
is not published, and an author therefore re-derives the same contracts and re-collects the same
failure modes in every plugin repository. The evidence and the scope decisions are in
[notes/evaluation.md](notes/evaluation.md).

**Status: 0.1.0-alpha.** The version stays in the `0.1.0-alpha.N` line until 0.1.0 is released.
0.1.0 covers the host face and the manual; client/UI plugin categories and static checks for the
out-of-tree package contract are planned for 0.2.0+.

## Prerequisites

- Node.js >= 22.19 (`engines.node`)
- pnpm (CI pins pnpm 11; the lockfile is `lockfileVersion: 9.0`)

## Commands

| Command              | What it does                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`       | Install dependencies (`allowBuilds: esbuild` is already allow-listed)                                                             |
| `pnpm build`         | tsup → `dist/`, then `scripts/build-client.mjs` → `dist/client.js`, then `scripts/build-skill.mjs` copies `skill/` → `dist/skill` |
| `pnpm test`          | vitest (no coverage thresholds)                                                                                                   |
| `pnpm test:coverage` | vitest + coverage — the real gate (lines/functions/statements 80, branches 70)                                                    |
| `pnpm check-types`   | `tsc --noEmit`                                                                                                                    |
| `pnpm lint`          | eslint                                                                                                                            |
| `pnpm format`        | `prettier --write .`                                                                                                              |
| `pnpm format:check`  | `prettier --check .`                                                                                                              |
| `pnpm pack:check`    | `pnpm pack --dry-run`: inspect what would actually be published                                                                   |

Before pushing, run the same set CI runs (`.github/workflows/ci.yml`):

```sh
pnpm lint && pnpm check-types && pnpm format:check && pnpm test:coverage && pnpm build && pnpm pack:check
```

## Layout

The repository **is** the package: there is one `package.json`, at the root, and all work extends
that single package. No workspace, no second package.

```
package.json          the dsh plugin package
cordis.patch.yml      bundle patch that mounts the plugin (must stay in `files`)
src/                  plugin source: the host entry, the skill sync, and their tests
src/uv/               experimental submodule #1: the host `uv` tool (opt-in)
src/keyboard/         experimental submodule #2: the prompt-card Enter/arrow-key client half
skill/                the skill this plugin ships and installs (single source of truth)
scripts/              client bundle build + skill copy + the postinstall install guard
locale/               plugin display metadata (title/description dictionaries)
notes/                evaluation, design and decision records
dist/                 build output (gitignored): the ESM entries, client.js, types, and a copy of skill/
```

`dist/` is generated and never committed. `notes/` and `AGENTS.md` are repository docs and are
**not** part of the published package: the tarball carries `dist/`, `cordis.patch.yml`, `locale/`
and the postinstall script, and nothing else (see `files` in `package.json`).

## The skill is product source

`skill/` is the single source of truth for the manual; `scripts/build-skill.mjs` copies the whole
directory into `dist/skill`, and the installed package syncs that tree to
`$DSH_HOME/skills/dsh-dev-dsh`. A build without `skill/SKILL.md` fails hard — better no package than
a package without its skill.

Because of that, `skill/**` changes are **product** changes: commit them with a `feat(skill): `
prefix, not `docs:`. The layer/naming/index contract lives in
[notes/skill-design.md](notes/skill-design.md) and is machine-checked by `src/facts.test.ts`.

## Dogfooding skill changes

An installed copy of the skill is what agents actually read (`$DSH_HOME/skills/dsh-dev-dsh`), and
`apply()` rewrites that copy on every plugin load — so without a dev path, every `skill/**` edit
would need a rebuild and a reload. `--link` replaces the copy with a symlink to the worktree:

```sh
pnpm build                                          # once: builds the CLI itself
pnpm run dogfood:skill                              # $DSH_HOME/skills/dsh-dev-dsh -> <repo>/skill
node dist/install-skill.js --verify --source skill  # exit 0 = the install matches that source
```

After that, edit `skill/**` and the next `skill` load sees the change — no rebuild, no sync; the
provider re-reads every loaded body from disk. `--source <dir>` picks a different source (the
default is the bundled `dist/skill`, so the published copy-and-sync path is unchanged), `--force`
replaces an existing real directory, and `--copy` restores that published path.

Two boundaries worth knowing: `AGENTS.md` is injected by the host per turn rather than read from the
installed tree, and a running dsh process keeps the `dist` modules it loaded at boot — so after
editing `src/**`, rebuild `dist` before reloading the plugin. In an agent session this command
writes outside the workspace (`$DSH_HOME/skills`), so a sandboxed run needs one escalation; on
Windows, prefer `--copy`.

## Reference trees and facts

`3rdp/` is a local, gitignored, read-only reference checkout of the harness used for source
archaeology. It is **not** required: a clone or install without it builds, runs and tests normally.

Where it exists, `src/facts.test.ts` re-verifies the upstream facts that `skill/**` cites and
reports the ones that moved; where it is absent that re-verification is skipped and nothing else
changes. Every upstream path referenced from `skill/**` must be registered as a fact, and vice
versa. Do not make a missing `3rdp/` block any test, build or install.

## Documentation split

- `README.md` (English) and `README.zh.md` (Chinese) are the outward-facing pair: one document in
  two languages, the same sections in the same order, each opening with a link to the other. Change
  both sides in the same commit — `src/docs.test.ts` checks the cross-links, the badge block and the
  heading structure.
- `CONTRIBUTING.md` — English only; there is no translated twin.
- `AGENTS.md` / `notes/` / `skill/` — Chinese-dominant, inward-facing (AI navigation, records, the
  manual itself). Identifiers, commands and paths stay English.
- npm auto-includes both `README.md` and `README.zh.md` in the published tarball (the `README*` name
  rule), so neither needs an entry in `files`.

Issue, plan and milestone tracking lives in `mint`, not in these docs; the workflow is the `mint`
skill's business.

## Releasing

Two registries carry the same name — npmjs (the primary source) and GitHub Packages. `package.json`
needs no `publishConfig`: each workflow job sets its registry through `actions/setup-node`'s
`registry-url`.

**First release (local, once).** npmjs trusted publishing can only be configured for a package that
already exists, so the first publish is manual:

```sh
pnpm install
pnpm build
pnpm pack:check                                    # verify dist + cordis.patch.yml + locale + skill
npm publish --access public --tag alpha            # prerelease: --tag alpha
npm publish --access public                        # or a stable version
```

Then open the package on npmjs and register this repository plus
`.github/workflows/publish-npm.yml` as its trusted publisher.

**Later releases (CI).** Pushing a tag whose name is the version (with or without a `v` prefix)
runs `.github/workflows/publish-npm.yml`:

- `gate` fails unless the tag equals `package.json`'s version. A version containing `-`
  (`0.1.0-alpha.1`) is a prerelease: the pipeline stops after `test`, publishes nothing and creates
  no GitHub Release.
- Stable versions publish to npmjs over OIDC (`--provenance`, no token), then to GitHub Packages
  with `GITHUB_TOKEN`, and only after **both** registries succeed is a GitHub Release created from
  the tag's generated notes.
- Both publish steps skip a version that is already on their registry, so re-running a tag whose
  pipeline half-failed completes instead of failing on "cannot publish over the existing version".

```sh
git tag 0.1.0 && git push origin 0.1.0                     # stable: publishes and releases
git tag v0.1.0-alpha.2 && git push origin v0.1.0-alpha.2   # prerelease: gate + test only
```

Version numbers in a prerelease line stay in that line (`0.1.0-alpha.N`) until 0.1.0 itself ships.

## Design records

- [notes/evaluation.md](notes/evaluation.md) — why this project exists, scope decisions, version
  planning.
- [notes/skill-design.md](notes/skill-design.md) — the manual's structural contract and design
  guide.
- [notes/uv.md](notes/uv.md) — experimental submodule #1 (host `uv` tool): evidence, rejected
  alternatives, tool and approval contract, trust boundary, known limits, extraction path.
- [notes/keyboard.md](notes/keyboard.md) — experimental submodule #2 (prompt-card keys): the focus
  gap, rejected patches, declaration and mounting, upstream coupling, known limits.
- [notes/runtime-triage.md](notes/runtime-triage.md) and
  [notes/client-console-diagnosis.md](notes/client-console-diagnosis.md) — diagnosis methods, both
  curated into the manual under `skill/references/dogfood/`.
- [notes/resource-preview-protocol-bug.md](notes/resource-preview-protocol-bug.md) — a recorded
  upstream problem (symptom, root cause, workaround).
