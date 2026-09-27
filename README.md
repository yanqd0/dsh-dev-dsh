# dsh-dev-dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
plugin for developing dsh plugins: it ships the **out-of-tree** authoring method
as a skill, and installs that skill together with the plugin.

"Out-of-tree" means a plugin that lives in its own repository, builds with its
own toolchain, and publishes to npm — rather than inside the `deepseek-harness`
monorepo.

## Why this exists

dsh already ships capable authoring support for the *in-profile* case: Creator
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
cordis.patch.yml      bundle patch that mounts the plugin   (0.1.0)
src/                  plugin source                          (0.1.0)
skill/                the skill this plugin ships and installs (0.1.0)
notes/                evaluation and decision records
```

## Development

Nothing to install yet; the package has no dependencies at this stage.

`3rdp/deepseek-harness/` is a read-only reference checkout of the harness used
for source archaeology; it is gitignored and not part of the package.

## License

MIT
