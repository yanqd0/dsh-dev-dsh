# dsh-dev-dsh

[![CI](https://github.com/yanqd0/dsh-dev-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/yanqd0/dsh-dev-dsh/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@yanqd0/dsh-dev-dsh.svg)](https://www.npmjs.com/package/@yanqd0/dsh-dev-dsh)

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that ships an
**out-of-tree** dsh plugin development manual as a skill: installing the plugin installs the manual
with it.

"Out-of-tree" means a plugin that lives in its own repository, builds with its own toolchain, and
publishes to npm — rather than inside the `deepseek-harness` monorepo.

## Install

```sh
dsh plugin --profile web add @yanqd0/dsh-dev-dsh \
  --allow-build=@yanqd0/dsh-dev-dsh
```

`web` is the profile behind `dsh web`; any other profile name works the same. `--allow-build` lets
the package's `postinstall` sync the skill; without it the skill is still installed when the plugin
loads, because the sync has two entry points and the host-side one is the fallback.

Restart DSH afterwards — the plugin config and the profile's package resolution are both fixed at
boot — and check that the plugin is mounted and the skill landed:

```sh
dsh --profile web --dump-config | grep -c 'id: dsh-dev-dsh'   # must be 1
ls ~/.dsh/skills/dsh-dev-dsh/SKILL.md
```

### From GitHub Packages

The same name is published to both registries. GitHub Packages requires authentication even for
public packages, with a token carrying the `read:packages` scope; add both lines to `~/.npmrc`:

```
@yanqd0:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install exactly as above.

## Usage

Ask the agent to develop, package, or debug a dsh plugin that lives in its own repository. No
command is needed: the skill decides from the request whether it applies, routes to the right
reference page, and falls back to the facts of the running dsh when a page does not cover the case.

The manual is a thin entry (`SKILL.md`) plus indexed pages in three categories — **plugin
development** (per-category flows, manifest and mounting, client/UI plugins, subprocess trust),
**the dsh itself** (architecture, boot and composition, session log and storage, built-in modules),
and **dogfood and triage** (running a plugin locally, runtime evidence, client console diagnosis).

The top layer of the manual carries no upstream paths or version numbers, so it does not age with
dsh. The dsh baseline the pages are verified against is declared once, in the manual's version page
(`references/dsh/versions/index.md`).

## Options

Both optional submodules are **off by default**. Enable one in the profile's `cordis.patch.yml` and
restart the harness.

### `uv` tool (experimental)

Under a `workspace-write` file policy every ordinary `uv` call hits the sandbox: uv writes its
shared cache and managed installs under `$HOME`, so each one is denied and retried with an
escalation — one approval per command. This submodule runs `uv` **inside the plugin process**
instead, through the host subprocess seam, so the session file sandbox never sees it and argv and
output pass through unchanged.

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

It is opt-in because it widens the trust boundary: `uv` and its children (including anything
`uv run` executes) are no longer confined. A few classes still ask once per session per class
(`self update`, `publish`, `cache clean|prune`, `python install|uninstall`,
`tool install|uninstall|upgrade`, `auth`, `uv pip --system`, and any target outside the workspace);
without an answerer those classes fail closed.

### Prompt-card keys (experimental)

Every prompt card in the Web GUI — the approval card, the plan review, an `ask_user_question` card —
takes over the composer **without taking focus**, and each one binds its keyboard behaviour to
elements that must already be focused. With focus on `document.body`, Enter therefore does nothing
at all on those cards. This submodule fills exactly that gap from the browser side: Enter triggers
the card's default action, ↑/↓ move focus between its options, and a newly rendered card takes focus
once. It never consumes the gesture, so upstream behaviour stays authoritative wherever it exists.

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-dev-dsh
  config:
    keyboard:
      enabled: true
```

Unlike the `uv` tool, this switch is evaluated by the **browser half** (the browser cannot read the
mount line), so enabling it requires a harness restart **and** a page refresh.

Design notes, rejected alternatives and known limits for both submodules are indexed in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
