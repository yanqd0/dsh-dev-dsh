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
`@deepseek-ai/dsh-*` dist-tags are stale (`0.0.1-rc.1`) against a `0.1.7-rc.2`
runtime. An author therefore re-derives the same contracts and re-collects the
same failure modes in every plugin repository.

This plugin closes that gap for its own plugin repositories first, then
publishes. The reasoning and the evidence behind the scope are in
[notes/evaluation.md](notes/evaluation.md).

## Status

**0.1.0-alpha.1** — in development. The version stays in the `0.1.0-alpha.N`
line until 0.1.0 is released.

Development is planned in two milestone lines; the live plan is tracked with
the `mint` tool in this project.

**0.1.0 — a dsh 0.1.7 skill that ships with its plugin**

- Fix the dsh 0.1.7 out-of-tree authoring method as a `SKILL.md` shipped inside
  the package, covering what the official creator skill leaves out.
- Install that skill as part of `dsh plugin add`, so the knowledge arrives with
  the plugin instead of being copied by hand.
- Publish the first version to npm.

**0.2.0+ — plugin categories and dsh drift**

- Fill in plugin categories one at a time: client/UI bundles, MCP, skill-only
  plugins, presets, tools and hooks.
- Add static checks for the out-of-tree package contract, with rules keyed by
  dsh version.
- Maintain the version-difference knowledge for dsh releases after 0.1.7
  (session format v3 → v4, the removed completion API, the peer compatibility
  gate), so a class of breakage is known before it is rediscovered.

Later versions follow the upstream release cadence rather than a fixed
schedule.

## Layout

The repository **is** the package: there is one `package.json`, at the root,
and all future work extends that single package. No workspace, no second
package.

```
package.json          the dsh plugin package
cordis.patch.yml      bundle patch that mounts the plugin
src/                  plugin source: the host entry, the skill sync, and their tests
skill/                the skill this plugin ships and installs (single source of truth)
scripts/              build-time skill copy + the postinstall install guard
notes/                evaluation and decision records

dist/                 build output (gitignored): the ESM entries, their types, and a copy of skill/
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

`3rdp/` is a local, gitignored reference checkout of the harness used for source
archaeology. It is **not** part of the package and is **not required**: a clone
or install without it builds, runs, and tests normally. Where it is present,
`src/facts.test.ts` re-verifies the upstream dsh facts that `skill/` relies on
and reports any that have moved; where it is absent, that re-verification is
skipped and nothing else changes.

## License

MIT
