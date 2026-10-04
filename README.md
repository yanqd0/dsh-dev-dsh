# dsh-dev-dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
plugin for developing dsh plugins: it ships the **out-of-tree** authoring method
as a skill, and installs that skill together with the plugin.

"Out-of-tree" means a plugin that lives in its own repository, builds with its
own toolchain, and publishes to npm — rather than inside the `deepseek-harness`
monorepo.

## Why this exists

dsh already ships capable authoring support for the _in-profile_ case: Creator
mode (the `cordis` agent preset) carries the `cordis-plugin-development` skill
with templates, the `cordis_inspect_*` runtime API probes, and
`plugin_manager`. Those cover "write a small plugin that installs into my
running profile".

They do not cover the out-of-tree engineering path, and the harness leaves that
path to third parties by design: its own project-scaffolding toolchain was
removed, its shared client build preset is not published, and the published
`@deepseek-ai/dsh-*` dist-tags were stale (`0.0.1-rc.1`) against the runtime of
the time (`0.1.7-rc.2`). An author therefore re-derives the same contracts and
re-collects the same failure modes in every plugin repository.

This plugin closes that gap for its own plugin repositories first, then
publishes. The reasoning and the evidence behind the scope are in
[notes/evaluation.md](notes/evaluation.md).

## Status

**0.1.0-alpha.1** — in development. The version stays in the `0.1.0-alpha.N`
line until 0.1.0 is released.

Development is planned in two milestone lines; the live plan is tracked with
the `mint` tool in this project. The release mechanics are in
[Publishing](#publishing).

**0.1.0 — an out-of-tree authoring manual that ships with its plugin**

- Ship the out-of-tree DSH authoring method as a **lazy-loaded manual**: a thin
  `SKILL.md` entry plus per-category reference trees, so an agent can develop a
  plugin and diagnose it without reading dsh source.
- Content baseline is the dsh version the runtime actually carries; the current
  baseline is declared once, in the manual's version page. The manual's top
  layer — layered architecture, plugin model, extension points, design
  principles, the concept model and the domain vocabulary — is this milestone's
  core; per-module and per-built-in-plugin pages, per-category development
  flows, the dogfood flows, and the reverse CHANGELOG from the previous baseline
  follow under the same milestone.
- Install that skill as part of `dsh plugin add`, so the knowledge arrives with
  the plugin instead of being copied by hand.
- Publish the first version to npm.

**0.2.0+ — client/UI plugin categories and contract checks**

- Extend the manual to the classes that need the unpublished client build path
  (web UI / client plugins), and add static checks for the out-of-tree package
  contract, with rules keyed by dsh version.
- Later versions follow the upstream release cadence rather than a fixed
  schedule.

## Layout

The repository **is** the package: there is one `package.json`, at the root,
and all future work extends that single package. No workspace, no second
package.

```
package.json          the dsh plugin package
cordis.patch.yml      bundle patch that mounts the plugin
src/                  plugin source: the host entry, the skill sync, and their tests
src/uv/               experimental submodule #1: the host `uv` tool (opt-in, see below)
src/keyboard/         experimental submodule #2: the prompt-card Enter/arrow-key client half
src/client-entry.ts   browser-half entry; scripts/build-client.mjs wraps it into dist/client.js
skill/                the skill this plugin ships and installs (single source of truth)
scripts/              build-time client bundle + skill copy + the postinstall install guard
notes/                evaluation and decision records

dist/                 build output (gitignored): the ESM entries, client.js, their types, and a copy of skill/
dist/skill/           what actually ships and gets installed
```

`dist/` is generated and never committed. `notes/` and `AGENTS.md` are repository
docs — they are not part of the published package: the tarball carries `dist/`,
`cordis.patch.yml`, and the postinstall script, and nothing else (see `files` in
`package.json`).

## Development

```bash
pnpm install        # zod is a runtime dependency; esbuild is allow-listed for builds
pnpm build          # bundles dist/ (ESM + types) and copies skill/ into dist/skill
pnpm test           # vitest
pnpm check-types    # tsc --noEmit
pnpm lint           # eslint src
pnpm pack:check     # pnpm pack --dry-run: inspect what would actually be published
```

Issue, plan, and milestone tracking lives in `mint`, not in these docs;
[AGENTS.md](AGENTS.md) is the contributor-facing project navigation.

### Dogfooding skill changes

An installed copy of the skill is what agents actually read (`~/.dsh/skills/<name>`), and the
copy is written by `apply()` on every plugin load — so without a dev path, every `skill/**`
edit needs a rebuild and a reload. `--link` replaces that copy with a symlink to the worktree:

```bash
pnpm build                                          # once: builds the CLI itself
pnpm run dogfood:skill                              # ~/.dsh/skills/dsh-dev-dsh -> <repo>/skill
node dist/install-skill.js --verify --source skill  # exit 0 = the install matches that source
```

After that, edit `skill/**` and the next `skill` load sees the change — **no rebuild, no sync**;
the provider re-reads every loaded body from disk. `--source <dir>` picks a different source
(the default is the bundled `dist/skill`, so the copy path and `postinstall` are unchanged),
`--force` replaces an existing real directory, and `--copy` restores the published
copy-and-sync path.

Two boundaries worth knowing: `AGENTS.md` is injected by the host per turn rather than read from
the installed tree, and a running dsh process keeps the `dist` modules it loaded at boot — so
after editing `src/**`, rebuild `dist` before reloading the plugin.

Note for agent sessions: this command writes `$DSH_HOME/skills`, outside the workspace, so a
sandboxed run needs one escalation. On Windows, prefer `--copy`.

### Optional: the host `uv` tool (experimental submodule #1)

Under a `workspace-write` file policy, ordinary `uv` work keeps hitting the sandbox: uv writes its
shared cache and managed installs under `$HOME` (`~/.cache/uv`, `~/.local/share/uv`), every such
call is denied, and the model retries it with `sandbox_permissions: danger-full-access` — one
approval per command. The optional `uv` tool removes that loop: it runs `uv` **inside the plugin
process** through `ctx.subprocess`, which the session file sandbox never sees, and passes argv and
output through unchanged.

It is **off by default** (`uv.enabled: false`), because it changes the trust boundary: `uv` and its
children (including anything `uv run` executes) are no longer confined. That is the same widening as
today's `danger-full-access` retry, except it is configured once instead of confirmed per call.

Enable it in the profile's `cordis.patch.yml` and restart the harness (a running dsh keeps the `dist`
modules it loaded at boot):

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-dev-dsh
  config:
    uv:
      enabled: true
      # entry: ~/.local/bin/uv    # default: `uv` resolved on PATH
      # timeoutMs: 600000         # per-call wall clock, default 10 minutes
      # passEnv: [UV_INDEX_URL]   # forward credential-shaped ambient names on demand
```

A few classes ask first (`self update`, `publish`, `cache clean|prune`, `python install|uninstall`,
`tool install|uninstall|upgrade`, `auth`, `uv pip --system`, and any `--directory`/`--project`/
`--cache-dir`/`--config-file`/`cwd` target outside the session workspace) — once per session per
class, through the same approval seam the bash escalation uses. Without an answerer those classes
fail closed. The design, the rejected alternatives (in particular why uv's cache directories are
**not** redirected into the workspace), and the known limits are in [notes/uv.md](notes/uv.md).

### Optional: prompt-card keys (experimental submodule #2)

Every prompt card in the Web GUI — the approval card, the plan review, a
`ask_user_question` card — takes over the composer **without taking focus**, and
each one binds its keyboard behaviour to elements that must already be focused
(the approval card gates its handler on `currentTarget.contains(document.activeElement)`;
the plan-review and question cards only listen on their buttons). With focus on
`document.body`, Enter therefore does nothing at all on those cards.

The optional `keyboard` submodule fills exactly that gap from the browser side,
through the shortcut service's already-arbitrated fixed input: Enter triggers the
card's default action (allow once / Approve / submit the preselected option), ↑/↓
move focus between the card's options, and a newly rendered card takes focus once.
It never consumes the gesture, so upstream behaviour stays authoritative wherever
it exists, and it stays out of modals, editable regions, and terminals.

It is **off by default** (`keyboard.enabled: false`), because it changes what
Enter and the arrow keys mean inside those cards:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-dev-dsh
  config:
    keyboard:
      enabled: true
```

Unlike the `uv` tool, this switch is evaluated by the **browser half** (the
browser cannot read the mount line), so enabling it requires a harness restart
**and** a page refresh — `dist/client.js` is read from disk when the host process
starts. No profile row is needed for the browser half itself: declaring
`dsh.client` in `package.json` is enough. The design, the upstream contracts it
depends on, and the known limits are in [notes/keyboard.md](notes/keyboard.md).

## Publishing

Two registries carry the same name: npmjs (the primary source) and GitHub
Packages. `package.json` needs no `publishConfig` — each workflow job sets its
registry through `actions/setup-node`'s `registry-url`, exactly as `dsh-mint`
does.

**First release (local, once).** npmjs trusted publishing can only be
configured for a package that already exists, so the first publish is manual:

```bash
pnpm install
pnpm build
pnpm pack:check                                    # verify dist + cordis.patch.yml + skill
npm publish --access public --tag alpha            # prerelease: --tag alpha
npm publish --access public                        # or a stable version
```

Then open the package on npmjs and register this repository plus
`.github/workflows/publish-npm.yml` as its trusted publisher.

**Later releases (CI).** Pushing a tag whose name is the version (with or
without a `v` prefix) runs `.github/workflows/publish-npm.yml`:

- `gate` fails unless the tag equals `package.json`'s version; a version with a
  `-` (such as `0.1.0-alpha.1`) stops after `test` and publishes nothing.
- stable versions publish to npmjs over OIDC (`--provenance`, no token), then
  to GitHub Packages with `GITHUB_TOKEN`, then create a GitHub Release from the
  tag's generated notes.

```bash
git tag 0.1.0 && git push origin 0.1.0             # stable: publishes and releases
git tag v0.1.0-alpha.2 && git push origin v0.1.0-alpha.2   # prerelease: gate + test only
```

Version numbers in a prerelease line stay in that line (`0.1.0-alpha.N`) until
0.1.0 itself ships.

`3rdp/` is a local, gitignored reference checkout of the harness used for source
archaeology. It is **not** part of the package and is **not required**: a clone
or install without it builds, runs, and tests normally. Where it is present,
`src/facts.test.ts` re-verifies the upstream dsh facts that `skill/` relies on
and reports any that have moved; where it is absent, that re-verification is
skipped and nothing else changes.

## License

MIT
