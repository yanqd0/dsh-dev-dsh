import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * Fact ledger for the dsh facts hardened into `skill/SKILL.md`.
 *
 * Why this file exists: the skill states upstream facts (paths, pins, schema
 * shapes) that go stale the moment dsh changes. The ledger records each fact
 * once, with the reference checkout it came from, so a stale pointer is
 * reported as one concrete entry instead of surfacing as wrong guidance to a
 * user months later.
 *
 * The ledger is *versioned metadata*: each fact carries the revision it came
 * from, and several revisions coexist on purpose (the current content plane
 * plus history pages). The metadata assertions below always run; re-verification
 * is per-revision and best-effort — the `3rdp/` reference tree is a local,
 * gitignored development convenience that does not ship, does not exist in
 * test/production (user installs), and whose absence must never break the
 * build, install, or test suite.
 *
 * Both halves of the skill ↔ ledger contract are enforced here:
 *
 * - Every upstream path cited by `skill/` must be a fact in this ledger.
 * - Every fact must name a known reference and a versioned revision.
 *
 * It also enforces the skill's in-tree contract (see `notes/skill-design.md`):
 * `SKILL.md` indexes every entry page and nothing else, every directory index
 * names the pages it owns, every page is reachable from `SKILL.md`, no in-skill
 * link dangles, every page names the index that owns it, and every name is
 * lowercase kebab-case. The structure is a graph on purpose — cross-category
 * references may form cycles.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SKILL_DIR = join(ROOT, 'skill');
const R3P_DIR = join(ROOT, '3rdp');

/** `<repo>@<tag>`: a reference checkout and the revision the facts came from. */
const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]*@[^\s@]+$/;

/**
 * Known reference checkouts, keyed by the `repo` half of `Fact.source`.
 *
 * `dir` is relative to `3rdp/`; `packageJson` is relative to `dir` and carries
 * the version that the tag should agree with. The tag convention strips a
 * `<repo>-v` prefix (e.g. `dsh-v0.1.7-rc.2` ⇄ `0.1.7-rc.2`). Add a row when a
 * new reference (e.g. cordis) is vendored under `3rdp/`.
 */
const REFERENCES: Record<string, { dir: string; packageJson: string }> = {
  'deepseek-harness': { dir: 'deepseek-harness', packageJson: 'package.json' },
};

/** Upstream paths the skill is allowed to cite, lifted out of `skill/`. */
const CITED_PATH_SHAPE = /(?:packages|apps|docs|\.agents|vendor|scripts)\/[A-Za-z0-9._/-]+/g;

/** In-skill links: skill/-relative paths under `references/`. */
const REFERENCE_LINK_SHAPE = /references\/[A-Za-z0-9._/-]+\.md/g;

/** The L0 entry page, relative to `skill/`. */
const ENTRY_PAGE = 'SKILL.md';

/** A page/directory name segment must be lowercase kebab-case. */
const PAGE_SEGMENT_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A `<repo>@<tag>` pin as it appears in skill prose. */
const PIN_IN_PROSE_SHAPE = /[a-z0-9][a-z0-9._-]*@[a-z0-9][A-Za-z0-9._-]*/g;

/** A version literal — whatever it belongs to. */
const SEMVER_SHAPE = /\d+\.\d+\.\d+/;

/** A `<repo>@<tag>` pin whose tag looks like a version. */
const VERSION_PIN_SHAPE = /\b[a-z0-9][a-z0-9._-]*@(?:dsh-)?v?\d/;

/** The fixed placeholder marker; a placeholder must name the plan filling it. */
const PLACEHOLDER_MARKER = '占位｜归属：';
const PLACEHOLDER_PLAN_SHAPE = /plan #\d+/;

/**
 * The one page allowed to declare the manual's current baseline. The baseline
 * moves with the runtime, so keeping the claim in a single place turns an
 * upgrade into one judgement plus per-page pins (notes/skill-design.md §4.1).
 */
const BASELINE_OWNER = 'references/dsh/versions/index.md';

/** Prose that restates "this is the current baseline"; legal only in that page. */
const BASELINE_CLAIM_SHAPE = /当前基准|与本机运行时一致/;

/**
 * The one page that pairs English domain terms with their Chinese counterparts.
 * Everywhere else the terms stay English (notes/skill-design.md §10).
 */
const BILINGUAL_TERM_PAGE = 'references/dsh/concept-model.md';

/** The bilingual table's header row must lead with the English column. */
const BILINGUAL_HEADER_SHAPE = /^\|\s*English[^|]*\|[^|]*中文/m;

interface Fact {
  /** Stable slug of the fact as the skill states it. */
  id: string;
  /** Reference checkout and revision, `<repo>@<tag>`. */
  source: string;
  /** Upstream path, relative to that checkout. */
  path: string;
  /** Optional anchor line; bounds-checked against the file's line count. */
  line?: number;
  /** What the skill relies on this fact for. */
  note: string;
}

const facts: Fact[] = [
  {
    id: 'skill-frontmatter-schema',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/skill/skill-filesystem/src/index.ts',
    line: 797,
    note: 'SKILL.md frontmatter 只要求 name / description，其余字段可选（whenToUse 等）',
  },
  {
    id: 'creator-skills-dir',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset/skills',
    note: '官方 Creator mode 自带的 creator skill 所在目录（0.2.0 起 4 个，含 agent-experience；本 skill 不重复它们的内容）',
  },
  {
    id: 'agent-preset-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset/README.md',
    line: 50,
    note: 'agent-preset 与其 skills/ 的说明出处（0.2.0 起该段列出 4 个 creator skill）',
  },
  {
    id: 'client-bundle-preset',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/tsdown.client.ts',
    note: '官方 client bundle 构建 preset（未随 npm 发布，仓外自行复现——0.2.0 门类）',
  },
  {
    id: 'client-module-table-baseline',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/web/src/platform.ts',
    note: 'web module table 的外部化基线（externals 取此处）',
  },
  {
    id: 'client-bundle-cookbook',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cookbook/adding-a-settings-card.md',
    note: '官方 cookbook 明说仓外包自行复现 client 构建',
  },
  {
    id: 'client-resource-protocol-parse',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/resources/src/client/resources.ts',
    line: 67,
    note:
      'protocolOf() 用 new URL(address).hostname 取资源类型；Chromium 对 dsh-resource://file/… ' +
      '给空 hostname（file 是特殊 scheme 名），Node 给 "file" ⟹ 浏览器里文件/计划预览报「不可用」。' +
      '见 references/client-console-diagnosis.md',
  },
  {
    id: 'out-of-tree-is-a-non-goal',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/archived/simplification/2026-08-11-remove-sdk-project-toolchain.zh.md',
    note: '官方主动移除 SDK 项目工具链：仓外工程化是官方非目标（本项目的存在理由）',
  },
  {
    id: 'author-docs-tree',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop',
    note: '面向插件作者的官方文档树（basic / framework / practice）',
  },
  {
    id: 'bundle-publish-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop/basic/publish.zh.md',
    note: 'bundle/profile manifest、层序、peer/dev 三分、git+prepare+allowBuilds 与 tarball 分发',
  },
  {
    id: 'tool-authoring-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop/basic/tool.zh.md',
    note: 'ctx.tools.register(defineTool(...)) 的最小可用写法',
  },
  {
    id: 'config-authoring-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop/basic/config.zh.md',
    note: 'Config schema 的默认值/必填与校验失败行为',
  },
  {
    id: 'events-authoring-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop/framework/events.zh.md',
    note: '事件 mode（emit/bail/serial/waterfall）与 waterfall 必须 next()',
  },
  {
    id: 'plugin-export-forms',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/AGENTS.md',
    note: 'function plugin 具名导出 name/inject/Config/apply，不可与 default 混用；可选服务用 ctx.get',
  },
  {
    id: 'default-export-postmortem',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/postmortem/0001-acp-default-export-drops-inject.md',
    note: 'default export 取代命名空间、静默丢掉 inject 的事故记录',
  },
  {
    id: 'bundle-manifest-type',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 69,
    note: 'DshBundleManifest 唯一必填字段 patch: string | string[]',
  },
  {
    id: 'engines-declarative',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 22,
    note: 'engines 是声明式字段，当前无 reader 执行',
  },
  {
    id: 'bundle-patch-files',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 58,
    note: 'bundlePatchFiles：patch 必须是字符串或字符串数组（否则抛错）',
  },
  {
    id: 'profile-user-layer-last',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 684,
    note: 'profile 自身的 cordis.patch.yml 在全部 bundle 层之后作为最后一层',
  },
  {
    id: 'overlay-read-failure',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/index.ts',
    line: 340,
    note: '被引用的 patch 文件读不到时抛 `failed to read overlay`（启动失败，不是警告）',
  },
  {
    id: 'entry-patch-semantics',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/include/src/index.ts',
    line: 57,
    note: 'applyEntryPatches：insert 追加、裸条目按 id 覆盖且整体替换 config、命中失败只 warn',
  },
  {
    id: 'same-id-entry-reuse',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/loader/src/config/group.ts',
    line: 20,
    note: 'EntryGroup.create 同 id 复用同一 entry（last-wins），0.1.7-rc.2 无 duplicate id 抛错',
  },
  {
    id: 'entry-id-generation',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/loader/src/config/tree.ts',
    line: 51,
    note: 'ensureId 只为缺 id 的行生成随机 id',
  },
  {
    id: 'same-id-archived-note',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/archived/bug-fix/2026-08-12-fix-pwsh-terminal-overlay-dup.zh.md',
    line: 52,
    note: '`duplicate loader entry id` 旧断言的出处（引用 tag 之前的 group.ts:64，现已不成立）',
  },
  {
    id: 'unwrap-exports-default',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/loader/src/index.ts',
    line: 201,
    note: 'unwrapExports 优先 exports.default，混用会整体丢掉具名 inject/Config',
  },
  {
    id: 'config-validation-error',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/fiber.ts',
    line: 28,
    note: 'ValidationError 文本 `invalid config:\\n  - <message> (at <path>)`；校验同步执行',
  },
  {
    id: 'plugin-shape-error',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/registry.ts',
    line: 319,
    note: '非法插件形态抛 `invalid plugin, expect function or object with an "apply" method`',
  },
  {
    id: 'tool-register-contract',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 1063,
    note: 'ctx.tools.register 返回 disposer；output{schema,render} 必填；run_code 名字保留',
  },
  {
    id: 'define-tool-helper',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/schema.ts',
    line: 554,
    note: 'defineTool 从 parameters 推导并校验 args，生成 JSON Schema',
  },
  {
    id: 'agent-created-event',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent/src/runtime-types.ts',
    line: 261,
    note: "会话开始是 'agent/created'（带 source）；本快照没有 agent/session-start 事件",
  },
  {
    id: 'session-start-source',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent/src/runtime-types.ts',
    line: 125,
    note: "SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'",
  },
  {
    id: 'bundle-less-dependency-warning',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/operations.ts',
    line: 102,
    note: '无 dsh.bundle 的依赖只作普通依赖并打印警告，不成为 profile 层',
  },
  {
    id: 'bundle-reconcile-new-deps',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/operations.ts',
    line: 255,
    note:
      'profile 依赖 reconcile：只对 profile 里首次出现的依赖追加 bundles 并加载 patch ' +
      '⟹ 安装失败（如 ERR_PNPM_IGNORED_BUILDS）不写 bundles，重跑 add 也不会补，须 remove 后重装',
  },
  {
    id: 'build-approval-retries-install',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/index.ts',
    line: 474,
    note: 'installBundle 在装包前先 approveBuilds 写 allowBuilds=true 并重跑安装脚本',
  },
  {
    id: 'pnpm-build-blocked',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/install-failure.ts',
    line: 22,
    note: 'ERR_PNPM_IGNORED_BUILDS / Ignored build scripts 归类为 build-blocked',
  },
  {
    id: 'allow-builds-placeholder',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/build-approval.ts',
    line: 27,
    note: "pnpm 在 allowBuilds 留占位字面量 'set this to true or false' 表示待授权",
  },
  {
    id: 'git-hosted-prepare-hint',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/src/plugin.ts',
    line: 104,
    note: 'git 安装需作者 prepare + 用户 allowBuilds；dsh 打印修法',
  },
  {
    id: 'plugin-cli-forwards-pnpm',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/src/args.ts',
    line: 191,
    note: 'dsh plugin 把参数原样转发给 pnpm（add/remove/why/list…）',
  },
  {
    id: 'cli-reference',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/reference/README.zh.md',
    note: 'profile CLI 与层序的权威叙述',
  },
  {
    id: 'peer-compatibility-gate',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/plugin-compatibility.ts',
    line: 98,
    note: '只对 @deepseek-ai/dsh / @deepseek-ai/dsh-* 的 peerDependencies 做兼容门禁并给豁免路径',
  },
  {
    id: 'package-meta-resolution',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/package-meta.ts',
    line: 61,
    note: '元数据经 Node ESM resolver 解析；缺失资源（含 exports 未暴露）静默降级',
  },

  // dsh 0.2.0：`skill/references/dsh/` 顶层页（架构 / 插件模型 / 扩展点 / 设计原理 / 概念）的指针。
  // 这些 fact 按 checkout 版本复核（见下方 census）；换基准时同步重校 pin。
  {
    id: 'packages-layout-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/README.md',
    note: '包组划分与一行职责：层与能力门类包的权威清单',
  },
  {
    id: 'core-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core',
    note: '产品主干包组：agent / agent-loop / tools / session / system-prompt / scope',
  },
  {
    id: 'core-scope',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/scope',
    note: '按 agent 划分作用域的注册原语（库，无 ctx 键）',
  },
  {
    id: 'llm-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/llm',
    note: 'LLM 能力组：抽象服务 + provider 适配器',
  },
  {
    id: 'ssh-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/ssh',
    note: 'POSIX 远端连接：成对的 fs / subprocess / sandbox provider',
  },
  {
    id: 'host-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host',
    note: 'Web GUI host 服务：HTTP 路由、静态前端分发、目录选择、插件清单',
  },
  {
    id: 'api-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/api',
    note: '远程 BFF 与 Typert RPC 网关（host 侧接口面）',
  },
  {
    id: 'sdk-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/sdk',
    note: '进程外 SDK：JSON-RPC 协议与 TypeScript client / server',
  },
  {
    id: 'acp-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/acp',
    note: '仅用于自动化的 ACP 服务器',
  },
  {
    id: 'client-modules',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules',
    note: '客户端模块系统：宿主组 boot graph 并下发插件 bundle，浏览器懒加载',
  },
  {
    id: 'apps-web',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/web',
    note: 'Web 应用壳（Vite 入口；boot 数据由 dsh web 注入）',
  },
  {
    id: 'apps-desktop',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/desktop',
    note: 'Electron 桌面应用：自带运行时与 desktop profile',
  },
  {
    id: 'apps-desktop-host',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/desktop-host',
    note: 'Desktop Host 进程：挂载共享 CLI profile runner 与完整 Web 应用',
  },
  {
    id: 'dev-guide-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/development.zh.md',
    note: 'TypeScript 项目布局、compiler face、source plane 与 artifact plane 的分工',
  },
  {
    id: 'module-graph-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/module-graph.zh.md',
    note: 'harness 包之间的 peer（共享实例）依赖关系图',
  },
  {
    id: 'rescope-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/rescope.zh.md',
    note: 'vendor 包改名映射：cordis → @deepseek-ai/cordis',
  },
  {
    id: 'vendor-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/group',
    note: '嵌套插件分组（cordis:group）',
  },
  {
    id: 'vendor-timer',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/timer',
    note: '随 disposal 回收的定时器',
  },
  {
    id: 'vendor-hmr',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/hmr',
    note: '插件与配置的热替换',
  },
  {
    id: 'cordis-api-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cordis-api',
    note: '生成的核心 API 参考：Context / events / Fiber 与继承层',
  },
  {
    id: 'capability-seams-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/capability-seams.zh.md',
    note: '服务与 capability seam 全景图：核心主干服务、可替换 seam、组合点、独立服务',
  },
  {
    id: 'dsh-glossary-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/glossary.zh.md',
    note: '领域词汇的权威定义：capability-seam、agent-scope、循环层级、目标、Ralph、人类命令',
  },
  {
    id: 'scope-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/scope.zh.md',
    note: '作用域注册标识、dispatch 载体与 Scope 上下文',
  },
  {
    id: 'upstream-root-agents',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'AGENTS.md',
    note: '上游仓库根常驻规则：注册即 effect、model-visible ⟺ logged、fail loud、显式 > 隐式、边界校验、branded id、source/artifact plane',
  },
  {
    id: 'defensive-patterns-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/defensive-patterns.zh.md',
    note: '生命周期、并发、子进程与 teardown 的防御性写法',
  },
  {
    id: 'session-format-status-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/session-format-status.zh.md',
    note: '会话格式的版本 / 状态权威与支持窗口',
  },
  {
    id: 'testing-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/testing.zh.md',
    note: '测试与门禁策略：源码面解析、覆盖率门禁与快照要求',
  },
  {
    id: 'i18n-terminology-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/i18n/terminology.md',
    note: '官方中英译法表：领域术语的规范中文对应',
  },
  {
    id: 'app-boot-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/README.zh.md',
    note: '启动策略：profile 组合、required 条目审计、失败矩阵、dump 与兼容性检查',
  },
  {
    id: 'boot-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/boot.zh.md',
    note: 'profile 管理：PluginManager 服务方法、bundle 行、app-boot/hmr/plugin-manager 事件',
  },
  {
    id: 'cmdline-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/cmdline',
    note: '启动器到应用的命令行交接：ctx.cmdlineArgs 快照',
  },
  {
    id: 'web-app-bundle',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app',
    note: 'web profile 的组合层：浏览器应用与客户端插件行',
  },
  {
    id: 'boot-hmr-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/hmr',
    note: '配置热重载服务：串行化模块重载、文件监视与管理写入',
  },
  {
    id: 'plugin-manager-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/README.zh.md',
    note: '运行期包操作：inspect/安装/删除/启停/组合包选择、构建审批、兼容性豁免与失败行为',
  },
  {
    id: 'client-modules-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules/README.zh.md',
    note: '客户端模块系统：dsh.client 声明、启动图、combo 路由与 revision、惰性 CJS factory',
  },
  {
    id: 'client-web-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/web/README.zh.md',
    note: 'Web 启动内核：两阶段启动、启动页、平台模块表与激活审计',
  },
  {
    id: 'client-hmr-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/hmr',
    note: '客户端 HMR 驱动器：重建 bundle 上的 invalidate / prefetch',
  },
  {
    id: 'host-webserver',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host/webserver',
    note: 'Web host 的 HTTP 服务：命名路由、index 注入与 SPA 回退',
  },
  {
    id: 'client-modules-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/client-modules.zh.md',
    note: '客户端模块子系统：web 插件表、WebBootGraph 协议与 bundle 路由',
  },
  {
    id: 'web-client-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/web-client.zh.md',
    note: 'Web 客户端分层：数据对象层、渲染机制与展示组件',
  },
  {
    id: 'dsh-architecture-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/architecture.zh.md',
    note: '架构主干的上游权威叙述：Cordis、profile 与组合包、核心包表、事件、轮次流程、会话日志',
  },
  {
    id: 'dsh-subsystems-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems',
    note: '子系统逐页参考（外部词汇与接线），模块页的首选上游对照',
  },
  {
    id: 'dsh-cordis-primer',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cordis-primer.zh.md',
    note: '"一切皆插件" 的框架前提：Cordis 入门',
  },
  {
    id: 'dsh-agent-lifecycle-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/agent-lifecycle.zh.md',
    note: 'Agent 生命周期时序图（轮次/步骤主干的可视化对照）',
  },
  {
    id: 'dsh-tool-pipeline-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/tool-execution-pipeline.zh.md',
    note: '工具执行流水线（pre-execute/execute/post-execute 的水位与语义）',
  },
  {
    id: 'dsh-event-map-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/event-producer-consumer.zh.md',
    note: '事件生产方/消费方映射，事件三域的权威清单',
  },
  {
    id: 'cordis-framework',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis',
    note: 'Cordis 框架：插件、服务、类型化事件与可逆副作用',
  },
  {
    id: 'cordis-loader',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/loader',
    note: '加载器：条目树与插件加载/卸载',
  },
  {
    id: 'cordis-include',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/include',
    note: 'patch（include）语义：按 id 覆盖或插入条目',
  },
  {
    id: 'core-agent',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent',
    note: 'Agent 接口、活跃 agent 注册表与 agent/* 事件（ctx.agents）',
  },
  {
    id: 'core-agent-loop',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent-loop',
    note: '默认 agent 驱动器（ctx.agentLoop）：轮次/步骤、请求构建、取消与 teardown 顺序',
  },
  {
    id: 'core-tools',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools',
    note: '作用域化工具注册表与带把关的执行流水线（ctx.tools）',
  },
  {
    id: 'core-session',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/session',
    note: '仅追加会话日志与 deriveMessages() 模型历史投影（ctx.sessions）',
  },
  {
    id: 'core-system-prompt',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/system-prompt',
    note: '提示词片段与工具 schema 的组装（ctx.systemPrompt）',
  },
  {
    id: 'llm-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/llm/llm',
    note: '消息与流式词汇表、适配器 seam（ctx.llm）',
  },
  {
    id: 'boot-app-boot',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot',
    note: 'profile 与组合包的叠加启动',
  },
  {
    id: 'boot-plugin-manager',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager',
    note: '插件安装与 reconcile（dsh plugin … 的宿主侧）',
  },
  {
    id: 'bundle-base',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/base',
    note: 'web/headless/sdk/acp profile 的共享第一层（含 plugin-manager）',
  },
  {
    id: 'cli-launcher',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli',
    note: 'launcher 与 profile CLI（dsh --profile …）',
  },
  {
    id: 'client-ui-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client',
    note: '客户端 UI 插件组（ui-*）与 web 应用',
  },
  {
    id: 'client-web',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/web',
    note: '浏览器 web 客户端',
  },
  {
    id: 'preset-agent-preset',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset',
    note: 'agent 组合预设（官方 creator skill 的宿主）',
  },
  {
    id: 'skill-packages',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/skill',
    note: 'skill 子系统：发现优先级、目录注入与按需加载',
  },
  {
    id: 'mcp-packages',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/mcp',
    note: 'MCP：外部工具与资源接入',
  },
  {
    id: 'hooks-packages',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks',
    note: 'Claude Code / Codex 桥接',
  },
  {
    id: 'jobs-packages',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs',
    note: '后台任务运行时',
  },
  {
    id: 'extensions-host-runner',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/extensions/cordis-host-runner',
    note: '运行时自扩展：动态 Cordis 插件的 Host 侧执行',
  },
  {
    id: 'extensions-client-runner',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/extensions/cordis-client-runner',
    note: '动态 Cordis 包的客户端半边：Builtin 符号面（ctx / React / host.call / styles / console）与 client Service / Slots provider',
  },
  {
    id: 'session-package-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/session/README.zh.md',
    note: '会话日志包契约：surface 元数据、消息投影注册、deprecated 读取方法、已知限制',
  },
  {
    id: 'session-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/session.zh.md',
    note: 'Session 子系统规范全文：SessionEventMap 逐成员语义、surface、deriveMessages、fork、TurnEndReasonMap',
  },
  {
    id: 'persistence-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/persistence.zh.md',
    note: '持久化 seam 规范：句柄契约、flush 检查点、崩溃恢复归属、SessionLocation 只作拒绝诊断',
  },
  {
    id: 'persistence-catalog-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/persistence-catalog.zh.md',
    note: '生成的事件词汇目录（含插件贡献）：payload、surface 标记、声明位置与类型指纹',
  },
  {
    id: 'agent-lifecycle-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/agent-lifecycle.zh.md',
    note: '轮次 / 步骤时序：assistant/message 与 assistant/attempt 的分工、实时 chunk frame 不持久',
  },
  {
    id: 'gen-persistence-catalog',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'scripts/gen-persistence-catalog.ts',
    note: '事件词汇目录生成器：KNOWN_SESSION_EVENT_TYPES 与 MESSAGE_PROJECTION_EVENT_TYPES 的来源',
  },
  {
    id: 'persistence-changes-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/persistence-changes/README.zh.md',
    note: '持久化类型变更记录规则：same-version 与 version-bump 的判定、定稿检查点与不可变记录',
  },
  {
    id: 'persistence-finalized-v4',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/persistence-changes/finalized/v4.json',
    note: '已接受兼容性基线（定稿记录）落在版本命名检查点里',
  },
  {
    id: 'session-format-version-cookbook',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cookbook/adding-a-session-format-version.zh.md',
    note: '新增相邻格式版本的实操：manifest 声明、codec 复用、归档前驱、继承 cut 是逻辑事件数',
  },
  {
    id: 'gen-session-format-catalog',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'scripts/gen-session-format-catalog.ts',
    note: '格式目录生成器：校验每版一个 codec、相邻边不缺口、codec 导出名与依赖一致',
  },
  {
    id: 'session-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/README.zh.md',
    note: 'session 包组地图：持久化 / 投影 / 标题 / 遥测四族与各自 ctx 键',
  },
  {
    id: 'session-checkpoint-policy',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-checkpoint-policy',
    note: 'checkpoint policy：在 llm/stream 首块、顶层 tools/execute、agent/pre-step 三处 fail-closed flush',
  },
  {
    id: 'session-persistence-seam',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-persistence',
    note: '持久化 seam：SessionPersistence 服务、SessionHandle、所有权错误与 revision 可比范围',
  },
  {
    id: 'session-persistence-jsonl',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-persistence-jsonl',
    note: 'JSONL provider：root/compression 配置、generation 文件名与选择、撕裂尾部恢复、无删除 API',
  },
  {
    id: 'group-index-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/README.zh.md',
    note: 'package group 索引：逐组一行职责，手册模块页的组清单来源',
  },
  {
    id: 'tool-catalog',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/tool-catalog.zh.md',
    note: '生成：每个面向模型的工具名 → 工具包 → 依赖 → 写入的事件，手册路由而不手抄',
  },
  {
    id: 'config-catalog',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/config-catalog.md',
    note: '生成：逐插件包的全部 Config 字段索引，模块页按包路由到这里',
  },
  {
    id: 'client-slot-catalog',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
    note: '生成：客户端 slot 座位表（谁声明、谁已占、需要哪个 owner），插件位置页路由到这里',
  },
  {
    id: 'loadable-plugin-list',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset/skills/cordis-composition-reference',
    note: '官方 creator skill：其 references 下的 packages.md 是生成的可载入插件包清单，手册只路由',
  },
  {
    id: 'api-gateway-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/api-gateway.zh.md',
    note: 'Remote 模型权威：@Remote/@RemoteScope、lookup、generation 与 /api',
  },
  {
    id: 'web-server-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/web-server.zh.md',
    note: 'HTTP 路由注册语义：exact / prefix 匹配、index 注入与唯一 fallback 座位',
  },
  {
    id: 'slots-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/slots.zh.md',
    note: '客户端 slot 契约：归属、props 分享与扩展 API',
  },
  {
    id: 'settings-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/settings.zh.md',
    note: 'settings 子系统：键的注册与读取语义，插件配置落点',
  },
  {
    id: 'tools-registry-duplicate-name',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    note: '工具名按 scope 唯一：重复注册抛 `tool "…" is already registered in this scope`',
  },
  {
    id: 'commands-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/commands',
    note: '命令注册表所在组：命令名的 scope 唯一性与文件回执解析器',
  },
  {
    id: 'commands-registry-duplicate-name',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/commands/src/index.ts',
    note: '命令名按 scope 唯一：重复注册抛 `command "…" is already registered in this scope`',
  },
  {
    id: 'permission-preset-auto-singleton',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/permission-presets/src/index.ts',
    note: '`auto` preset 单例：重复注册抛 `permission: preset "auto" is already registered`',
  },
  {
    id: 'llm-adapter-registry',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/llm/llm/src/index.ts',
    note: '模型适配器表：按 provider 唯一，重复注册抛 `LlmError(..., DUPLICATE_ADAPTER)`',
  },
  {
    id: 'session-title-provider-singleton',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-title/src/index.ts',
    note: '会话标题提供方单例：重复注册抛 `session-title provider "…" is already registered`',
  },
  {
    id: 'core-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/README.zh.md',
    note: 'core 组一行职责与「替换其中一项能力」的定位：主干可替换、驱动器唯一默认实现',
  },
  {
    id: 'core-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/core.zh.md',
    note: 'Agent 约定、创建与所有权、拦截与工具定义的主干走查',
  },
  {
    id: 'tools-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/tools.zh.md',
    note: 'ToolDefinition 全字段、schema DSL、受守卫执行流水线与展现类型',
  },
  {
    id: 'system-prompt-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/system-prompt.zh.md',
    note: '提示词组装：分节、上下文、变量与工具 schema 的跨包类型',
  },
  {
    id: 'adding-a-tool-cookbook',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cookbook/adding-a-tool.zh.md',
    note: '新增工具的步骤化实操（注册、schema、呈现与测试）',
  },
  {
    id: 'base-bundle-patch',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/base/cordis.patch.yml',
    note: '共享第一层挂载了哪些主干插件行；patch 命中同 id 时整份替换 config',
  },
  {
    id: 'llm-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/llm/README.zh.md',
    note: 'llm 组：提供方无关调用服务 + 适配器 + 重试 + 计量的 ctx 键表',
  },
  {
    id: 'llm-streaming-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/llm-streaming.zh.md',
    note: '消息 / 内容块 / 流式分片 / LlmFailure 词汇与适配器约定',
  },
  {
    id: 'llm-adapter-cookbook',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/develop/practice/llm-adapter.zh.md',
    note: '写一个提供方适配器的官方实操（适配器与模型发现）',
  },
  {
    id: 'session-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session',
    note: '会话数据平面包组（持久化 / 投影 / 标题 / 格式迁移）',
  },
  {
    id: 'session-projection-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/session-projection.zh.md',
    note: '投影 seam 三方分工、eager 驱动、整值事件规则与单元注册契约',
  },
  {
    id: 'session-title-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/session-title.zh.md',
    note: '标题状态、确定性回退与提供方契约（同时只允许一个）',
  },
  {
    id: 'session-telemetry-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/session-telemetry.zh.md',
    note: '会话遥测：采集与反馈后端的分离、脱敏与交付上限',
  },
  {
    id: 'session-query-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session-query',
    note: '会话查询包组：抽象引擎、SQLite 提供方、导出与模型工具',
  },
  {
    id: 'session-query-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session-query/README.zh.md',
    note: '查询组 ctx 键表：sessionQuery / sessionLogDownload / 五个工具',
  },
  {
    id: 'session-query-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/session-query.zh.md',
    note: '逻辑语料、来源优先级、追踪、语义提取与 provider 无关过滤',
  },
  {
    id: 'storage-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/storage',
    note: '通用存储包组：枢纽 + 两个后端 + 域形式',
  },
  {
    id: 'storage-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/storage/README.zh.md',
    note: '存储组选择指南与 ctx 键表（枢纽不做 IO）',
  },
  {
    id: 'storage-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/storage.zh.md',
    note: '后端契约、域声明、变更事件与枢纽职责',
  },
  {
    id: 'workspace-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/workspace.zh.md',
    note: '域形式的首个消费方：workspace 记录如何使用 storage 域',
  },
  {
    id: 'cli-reference-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/reference/README.zh.md',
    note: '启动器行为参考：模式、层序、dump 与 profile boot 细节',
  },
  {
    id: 'cli-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/README.zh.md',
    note: 'dsh 是唯一受支持的 Node 启动器；launcher flag 与 app 参数的边界',
  },
  {
    id: 'cli-composition-graph',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/composition.md',
    note: '生成：逐内置 profile 的精确装配图',
  },
  {
    id: 'boot-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/README.zh.md',
    note: 'boot 组：app-boot / cmdline / plugin-manager 的职责与共享 CLI 操作',
  },
  {
    id: 'boot-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot',
    note: '启动与 profile 管理包组',
  },
  {
    id: 'bundle-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/README.zh.md',
    note: 'bundle 组：dsh.bundle.patch 是成为 profile 层的唯一条件',
  },
  {
    id: 'bundle-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle',
    note: '内置组合包组（patch 层）',
  },
  {
    id: 'host-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host/README.zh.md',
    note: 'host 组：HTTP 服务器、SPA dist、目录选择 seam、清单与产品遥测',
  },
  {
    id: 'webserver-registry',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host/webserver/src/index.ts',
    note: '路由 kind（exact/prefix）与唯一 registerFallback 座位',
  },
  {
    id: 'api-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/api/README.zh.md',
    note: 'api 组：Remote 层职责划分（remotes 决定暴露、gateway 承载）',
  },
  {
    id: 'api-remote-forwarded-events',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/api/remotes/src/remote-events.ts',
    note: '转发事件白名单：未登记的事件不会被转发到客户端',
  },
  {
    id: 'api-remotes-client-assembly',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/api/remotes/src/client/index.ts',
    note: '客户端命名空间装配是硬编码导入 + 数组，仓外新增命名空间需上游扩展',
  },
  {
    id: 'adding-a-remote-api-cookbook',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cookbook/adding-a-remote-api.zh.md',
    note: '新增 Remote API 的步骤化实操与约定',
  },
  {
    id: 'typert-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/typert/README.zh.md',
    note: 'typert 组：构建期生成器 + 运行时注册表 + 协议包的三段分工',
  },
  {
    id: 'typert-packages-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/typert',
    note: 'Typert 类型面包组',
  },
  {
    id: 'typert-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/typert.zh.md',
    note: 'Typert 公共契约：ctx.typert / 生成产物 / 注册语义',
  },
  {
    id: 'product-telemetry-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/product-telemetry.zh.md',
    note: '产品遥测：事件类型、显式提交与交付上限',
  },
  {
    id: 'client-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/README.zh.md',
    note: 'client 组：浏览器体验的包/ctx 键表与内核-功能包分工',
  },
  {
    id: 'client-package-agents',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/AGENTS.md',
    note: '客户端包规则：导出纪律、共享模块、ui-renderer 是唯一 ctx→React 绑定点',
  },
  {
    id: 'client-modules-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/client-modules.zh.md',
    note: '客户端声明、启动图、/plugins bundle 路由',
  },
  {
    id: 'web-client-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/web-client.zh.md',
    note: 'Web 客户端分层与所有权',
  },
  {
    id: 'ui-slots-registration-conflicts',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-slots/src/index.ts',
    note: 'slot 注册冲突：一个 declarer、同 id 同 priority 二次注册抛错（already declared / already has a definition）',
  },
  // plan #17 A 批：插件分类开发流程页（tool / 外围扩展 / 核心替换 / skill 型）引用的上游事实。
  {
    id: 'tool-unsupported-json-schema',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/json-schema.ts',
    line: 70,
    note: 'output.schema 不受支持时抛 JsonSchemaError(UNSUPPORTED_SCHEMA)：unsupported JSON schema: …',
  },
  {
    id: 'tools-pipeline-events',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 153,
    note: '工具流水线事件声明：tools/pre-execute(waterfall) / tools/execute(wrapper) / tools/post-execute(waterfall) / tools/result(emit)',
  },
  {
    id: 'tool-guard-monotonic',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 1136,
    note: 'ctx.tools.guard 单调守卫（不可重排的策略面，approval 之后运行）',
  },
  {
    id: 'tools-schemas-projection',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 1260,
    note: 'ctx.tools.schemas() 只白名单 name/description/parameters，是模型可见投影',
  },
  {
    id: 'tool-additional-properties-required',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/schema.ts',
    line: 368,
    note: '显式 type: object 的参数节点必须表态 additionalProperties，否则 schema 校验抛错',
  },
  {
    id: 'real-composition-test-policy',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/AGENTS.md',
    line: 7,
    note: 'product-visible 插件必须有非单测的 REAL-composition 测试（经 Loader 与进程 boot）',
  },
  {
    id: 'llm-register-adapter-signature',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/llm/llm/src/index.ts',
    line: 396,
    note: 'ctx.llm.registerAdapter(providers, adapter) 返回带 replace() 的注册句柄；加 provider 走这里而不是换 service',
  },
  {
    id: 'jobs-start-spec',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/jobs/src/index.ts',
    line: 110,
    note: 'ctx.jobs.start(spec): JobId 是后台任务接缝（抽象 Definition，需实现包）',
  },
  {
    id: 'jobs-spec-contract',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/jobs/src/types.ts',
    line: 126,
    note: 'JobSpec 字段（kind/label/owner/outputLimitBytes/run）与同步返回的 JobHooks',
  },
  {
    id: 'jobs-no-controller-error',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/jobs-local/src/index.ts',
    line: 209,
    note: '无 job controller 时抛 background jobs unavailable（组合里缺 dsh-tool-jobs 的典型报错）',
  },
  {
    id: 'fs-observation-policy-events',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/fs/fs-observation-policy/src/index.ts',
    line: 119,
    note: '只挂 fs/* 事件、不注册服务的外围扩展范式：单槽位决策事件故意不调 next()',
  },
  {
    id: 'cordis-effect-contract',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cordis-api/fiber.zh.md',
    line: 26,
    note: 'ctx.effect(execute, label?) 契约：disposer 逆序执行、二次调用 no-op、已 dispose 抛 INACTIVE_EFFECT',
  },
  {
    id: 'extension-cookbook-gate',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/cookbook/extension-cookbook.zh.md',
    line: 15,
    note: '官方外围扩展示例：tools/pre-execute 返回类型化决策；「原生钩子」就是在拦截点上的普通 Cordis 插件',
  },
  {
    id: 'cordis-service-base',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/service.ts',
    line: 11,
    note: 'Service Definition 基类：构造器内把服务名注册进 Reflect（抽象类或具体注册表，不是 TS interface）',
  },
  {
    id: 'cordis-service-name-conflict',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/reflect.ts',
    line: 290,
    note: '同隔离域重复注册服务名直接抛 service "<name>" has been registered at <fiber>（替换必须先禁官方行）',
  },
  {
    id: 'cordis-inactive-context',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/reflect.ts',
    line: 160,
    note: '消费者在提供者未激活时读取 required service 抛 cannot get required service "…" in inactive context',
  },
  {
    id: 'shell-service-definition',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/shell/src/index.ts',
    line: 64,
    note: '官方 Service Definition 范式：abstract class ShellExecutor extends Service',
  },
  {
    id: 'fs-service-definition',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/fs/fs/src/index.ts',
    line: 87,
    note: '官方 Service Definition 范式：abstract class FileSystem extends Service',
  },
  {
    id: 'agent-loop-service',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent-loop/src/index.ts',
    line: 330,
    note: 'agent loop 本身也是插件：class AgentLoop extends Service implements AgentFactory，可被同权替换',
  },
  {
    id: 'patch-name-is-assertion',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/include/src/index.ts',
    line: 116,
    note: 'patch 里的 name 只作断言：不符时 warn + skip，不能用来给已有行改名',
  },
  {
    id: 'base-bundle-rows',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/base/cordis.patch.yml',
    line: 34,
    note: 'base 层的官方行 id（llm / agent-loop / llm-deepseek / fs-sandbox…）是替换时的禁用目标',
  },
  {
    id: 'agent-team-profile-precedent',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/experimental/agent-team-profile/cordis.patch.yml',
    line: 5,
    note: '官方先例：用 disabled: true 禁掉既有行再插入自己的替代实现',
  },
  {
    id: 'app-boot-activation-audit',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/index.ts',
    line: 875,
    note: '启动激活审计：非 required 行失败只报 warning: N entries did not activate；required 才 startup failed',
  },
  {
    id: 'compatibility-preflight-disable',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/compatibility-preflight.ts',
    line: 82,
    note: 'peer 不匹配时 admission 直接把该行置 disabled 并写 disabling profile plugin …: Plugin <n>@<v> is incompatible',
  },
  {
    id: 'skill-local-provider-frontmatter',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/skill/skill-filesystem/src/index.ts',
    line: 807,
    note: '本地 skill 提供方的 frontmatter 失败是 warn + 跳过：invalid/missing YAML frontmatter、缺 name/description、非 kebab-case',
  },
  {
    id: 'skill-registry-bundled-rank',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/skill/skill/src/index.ts',
    line: 28,
    note: 'BUNDLED_SKILL_RANK = 600；注册表按层 + rank 仲裁，provider candidate 违规快速失败',
  },
  {
    id: 'skill-badge-provider',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/skill/skill-badge/src/index.ts',
    line: 55,
    note: '随包 provider 的最小官方实现：inject skills + ctx.skills.registerProvider，资产随 files 发布',
  },
  {
    id: 'skill-root-project-agents',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/skills',
    note: '本地 skill 发现的 project-agents 根（rank 200），对应 skill-plugins 页的 roots 表',
  },
  {
    id: 'skills-subsystem-rank-table',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/skills.zh.md',
    line: 66,
    note: '本地发现 roots 与 rank 表（user-dsh 400 的 <dshHome>/skills、bundled 600），以及目录包/扁平文件契约',
  },
  // plan #17 B 批：插件分类开发流程页（preset / MCP / hooks / web UI）引用的上游事实。
  {
    id: 'preset-agent-preset-registration',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset/src/index.ts',
    line: 28,
    note: 'agent preset 形态：Service.init 里 ctx.agentPresets.register(config)，与 dsh.profile 无关',
  },
  {
    id: 'preset-isolate-realms-error',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset-registry/src/mount.ts',
    line: 267,
    note: 'preset 行把服务发布到 root realm 时抛 Preset services require isolate realms（必须 group + isolate）',
  },
  {
    id: 'web-app-preset-carrier',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app/presets/cordis.patch.yml',
    line: 6,
    note: 'agent preset 的声明载体就是普通 patch 行（示例：name: dsh-agent-preset）',
  },
  {
    id: 'schedule-bundle-example',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/experimental/schedule-bundle',
    note: '上游最小的组合包真实样例（package.json + cordis.patch.yml 两文件）',
  },
  {
    id: 'bundle-is-a-layer-not-code',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/base/src/index.ts',
    line: 9,
    note: '组合包本身不跑代码：base bundle 的 src/index.ts 只有 export {}，实体是 patch 文件',
  },
  {
    id: 'manifest-three-roles',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 33,
    note: 'package.json.dsh 的三种角色：bundle（配置层）/ profile（层列表）/ client（客户端面），一个包可多角色但 bundle 与 profile 互斥',
  },
  {
    id: 'profile-bundles-reader',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 663,
    note: 'dsh.profile.bundles 只从 profile 目录的 package.json 读；层序 = bundles → profile patch → home patch → --patch',
  },
  {
    id: 'mcp-client-config-and-inject',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/mcp/mcp-client/src/index.ts',
    line: 119,
    note: 'mcp-client：一条目一 server，inject = [tools]（不发布 ctx.mcp）；Config 是 stdio/streamable-http 的 union，serverName 有正则约束',
  },
  {
    id: 'mcp-tool-naming-and-registration',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/mcp/mcp-client/src/tools.ts',
    line: 82,
    note: 'MCP 工具公开名 mcp__<serverName>__<rawName>（有损归一加 hash）；同步是 fetch→dispose 旧代→注册新代的两段式',
  },
  {
    id: 'mcp-resources-registration',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/mcp/mcp-resources/src/index.ts',
    note: '共享资源服务 ctx.mcpResources：按 scope 注册提供方，首个提供方启用三个资源工具',
  },
  {
    id: 'mcp-client-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/mcp/mcp-client/README.md',
    note: 'mcp-client 配置字段表与工具命名、静默失败（failOnStartupError 默认 false）说明',
  },
  {
    id: 'mcp-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/mcp.zh.md',
    line: 42,
    note: 'MCP 职责与作用域：客户端是每服务器一个的连接插件，不发布共享 ctx.mcp 服务',
  },
  {
    id: 'mcp-memory-guide',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/guide/mcp-memory.zh.md',
    note: '产品侧 MCP 样例：overlay/--patch 挂载外部 MCP server',
  },
  {
    id: 'acp-mcp-mount-precedent',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/acp/acp/src/mcp.ts',
    line: 29,
    note: '官方先例：在插件里按 Agent scope ctx.plugin(McpClient, config) 挂 MCP 客户端',
  },
  {
    id: 'hooks-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/README.zh.md',
    note: 'hooks 包组地图：hook-protocol 是共享库，hooks-claude-code / hooks-codex 是可配置插件',
  },
  {
    id: 'hook-protocol-events-and-dialect',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/types.ts',
    line: 19,
    note: 'durable 事件对 hook/invoked 与 hook/result；HookDialect 是闭集（claude-code | codex），第三方不能新增值',
  },
  {
    id: 'hook-codec-parse',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/codec.ts',
    line: 59,
    note: 'parseHookOutput：exit 2 = block，stdout JSON 只在 exit 0 且以 { 开头时解析，permissionDecision 走 hookSpecificOutput',
  },
  {
    id: 'hook-matcher',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/matcher.ts',
    line: 57,
    note: 'matchesMatcher：缺省 / 空串 / * 为 match-all；claude-code 字面量与 | 精确择一，codex 恒正则',
  },
  {
    id: 'hook-runner',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/runner.ts',
    line: 67,
    note: 'runHook 经 ctx.shell 起子进程（凭据擦洗、进程组取消、超时），DEFAULT_HOOK_TIMEOUT_MS = 600000',
  },
  {
    id: 'hook-merge',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/merge.ts',
    note: 'mergeHookOutputs：多个 hook 输出按最严格优先（deny > ask > allow）',
  },
  {
    id: 'hook-event-append',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hook-protocol/src/events.ts',
    line: 75,
    note: 'appendHookInvoked / appendHookResult：log-only 事件对按 handlerId 关联，turn 内成对',
  },
  {
    id: 'hook-config-load-warn',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/hooks/hooks-claude-code/src/index.ts',
    line: 120,
    note: 'hook 配置读/解析失败 = warn + 不注册任何 listener（could not load hook config … — no hooks registered），harness 照常启动',
  },
  {
    id: 'interception-extension-points-note',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md',
    line: 9,
    note: '设计判据：「native hooks」不是包，普通 Cordis 插件即可；CC/Codex bridge 只是把外部协议映射到 canonical 事件的 translator',
  },
  {
    id: 'webhook-runtime-seam',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/webhook/webhook/src/index.ts',
    note: 'webhook 是「外部事件 → 新 dsh 会话」的正规通道，事件表可按提供方合并扩展（与 hooks 相邻但不同面）',
  },
  {
    id: 'webhook-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/webhook.zh.md',
    line: 11,
    note: 'WebhookEventMap 可合并扩展，让树外适配器无需改 runtime 包',
  },
  {
    id: 'acp-bridge-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/acp/acp',
    note: '反向桥：把 dsh agent 暴露给外部 ACP 客户端；其内部还带 MCP 挂载器',
  },
  {
    id: 'client-manifest-parser',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules/src/client/manifest.ts',
    line: 161,
    note: 'dsh.client 的唯一 validator parseDshClient：platform 必填、inject/external 字符串数组、immediately 布尔',
  },
  {
    id: 'client-declaration-reader',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules/src/index.ts',
    line: 847,
    note: '宿主扫描 dsh.client：platform !== web 静默跳过；缺 exports["./client"] 才抛；dsh.client 本身不产生 Loader entry',
  },
  {
    id: 'client-module-resolution-error',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules/src/client/system.ts',
    line: 382,
    note: '浏览器模块表：未声明进 external 的非基线模块抛 cannot resolve（bundle purity gate 的运行时镜像）',
  },
  {
    id: 'client-host-entry-empty',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-shortcuts/src/index.ts',
    line: 3,
    note: 'client 插件的最小 host 半边：export function apply() {}（行为全在 browser 半边）',
  },
  // plan #18：dogfood 环境与取证流程页引用的上游事实。
  {
    id: 'dump-rewrites-root',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/src/profile-boot.ts',
    line: 171,
    note: 'prepareProfile 每次启动与每次 dump 都把 profile 根的 cordis.yml 重写为空根桩，只读环境会 EACCES',
  },
  {
    id: 'boot-warn-stderr',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/index.ts',
    line: 119,
    note: '启动期诊断的 warn 形参默认写 process.stderr（没有内建日志文件，进程输出就是默认日志面）',
  },
  {
    id: 'skip-bundle-stderr',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 120,
    note: '组合包被跳过时写 stderr：`<bin>: skipping profile bundle "<name>": <reason>`',
  },
  {
    id: 'startup-report-path',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/src/startup-diagnostics.ts',
    line: 58,
    note: 'required 启动失败的完整报告落在 `$DSH_HOME/logs/startup-<ISO>-<uuid>.log`（0600）；终端只印摘要与 Full diagnostics 路径',
  },
  {
    id: 'plugin-manager-operation-log',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/plugin-manager/src/operations.ts',
    line: 290,
    note: '每次 dsh plugin 操作在 profile 下开 `.plugin-manager/logs/operation-*/pnpm.log`（git 连通性检查是 github-connection-*/git.log），保留完整输出',
  },
  {
    id: 'web-url-stdout',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app/src/index.ts',
    line: 271,
    note: '`dsh web: <url>` 由 console.log 写 stdout；启动诊断其余部分走 stderr',
  },
  {
    id: 'logger-level-threshold',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/logger.ts',
    line: 155,
    note: '导出门槛 = exporter.levels[name] ?? levels.default ?? logger.level ?? INFO(1)；LoggerLevel 为 ERROR=0 / INFO=1 / WARN=2 / DEBUG=3',
  },
  {
    id: 'logger-ring-buffer',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/logger.ts',
    line: 213,
    note: 'LoggerService 自挂的唯一 exporter 是 1000 条 ring buffer（无 levels ⟹ 只收 ≥ INFO），ctx.logger 默认没有 console 出口',
  },
  {
    id: 'console-exporter-config',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/logger-console/src/shared.ts',
    line: 20,
    note: 'ConsoleExporter.Config（levels / colors / showTime / label…）：要 console 出口就挂这个插件并给 levels，它不在随附组合里',
  },
  {
    id: 'overlay-plugin-guide',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/user/guide/github-review.zh.md',
    note: '官方用法先例：overlay 用相对路径挂本地 `.mjs` 插件（放在 patch 文件旁边）',
  },
  {
    id: 'local-overlay-plugin',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/config/examples/github-review/cordis.yml',
    line: 9,
    note: "overlay 行 `name: './github-ready-review-rule.mjs'`：本地相对路径插件可直接被 patch 挂载",
  },
  {
    id: 'web-port-flag',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app/src/startup.ts',
    line: 53,
    note: 'web 应用启动参数：--port <n>（0 = OS 挑空闲端口）与 --no-open',
  },
  // plan #19：版本差分页（0.1.7 → 0.2.0、0.1.5 → 0.2.0）引用的上游事实。
  // 差分页需要「旧侧 / 新侧」两端：新侧与决策记录一律 pin 当前基准 tag，旧侧 pin 对应历史 tag
  // （台账本就按「当前内容面 + 历史页」多 tag 并存；checkout 只复核与它同 tag 的那些）。
  {
    id: 'web-app-patch-rows',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app/cordis.patch.yml',
    line: 45,
    note: '0.2.0 起该文件不含 time-context / schedule / ui-schedule；新增 desktop-product-telemetry(:45)、product-analytics(:57) 与 ui-settings-session-log(:396)',
  },
  {
    id: 'web-app-patch-rows-0-1-7',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/bundle/web-app/cordis.patch.yml',
    line: 125,
    note: '0.1.7-rc.2 时该文件以 disabled: true 挂着 time-context(:121)、schedule(:125)、ui-schedule(:370)——0.2.0 把它们交给可选 bundle',
  },
  {
    id: 'schedule-opt-in-note',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/implemented/architecture/2026-09-24-schedule-opt-in-optional-bundle.zh.md',
    line: 11,
    note: '§Decision：Schedule 三行移出 web-app、由 schedule-bundle 插入；未选中该 bundle 时按 id 定向的 patch 只报 `patch: entry <id> not found` 警告',
  },
  {
    id: 'upgrade-guide-schedule',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/upgrade-guide/v0.1.7-rc.2/schedule-optional-bundle/guide.zh.md',
    line: 18,
    note: '§迁移：开启可选 bundle、清理只写 disabled 的覆盖项、按启动日志确认的逐步操作',
  },
  {
    id: 'base-otel-row',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/base/cordis.patch.yml',
    line: 188,
    note: 'base 层新增 otel 行（包 packages/telemetry/otel），与 session-telemetry-otel 的端点 / 字节分批改动同批',
  },
  {
    id: 'telemetry-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/telemetry',
    note: '0.2.0 新增的 telemetry 包组（含 otel）',
  },
  {
    id: 'upgrade-guide-dir',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/upgrade-guide',
    note: '升级指南目录：结构与门禁在本窗口落地，按「变更所在版本」分目录（v0.1.7-rc.2 下两条）',
  },
  {
    id: 'telemetry-otel-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/telemetry/otel',
    note: '0.2.0 新增的 telemetry 包组里的 OTel 包',
  },
  {
    id: 'otel-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/otel.zh.md',
    note: 'OTel 导出子系统：端点、按字节分批、串行发送与超时 / watchdog 预算',
  },
  {
    id: 'otel-byte-limits-note',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/implemented/architecture/2026-09-25-session-log-otel-byte-limits.zh.md',
    note: '会话日志 OTel 字节上限与排空预算的决策记录',
  },
  {
    id: 'persistence-changes-dir',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/persistence-changes',
    note: '持久化变更记录目录：0.1.5 上不存在（0 个文件），0.1.7 起有 161 个文件 / 40 个中文页',
  },
  {
    id: 'historical-formats-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/persistence-changes/historical-formats/README.zh.md',
    note: '历史 Session 格式（含 V3）的 schema 与当前目录的引用关系',
  },
  // plan #7：0.1.5 历史线的深层差分页引用的上游事实。
  {
    id: 'session-format-migration-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-format-v3-to-v4',
    note: '0.1.5→0.1.7 期间新出现的迁移库：工具结果表示提升、消息来源改名、内容标签命名空间化、父目录事实补齐、序号重映射、delivery 代际与源审计拒绝规则',
  },
  {
    id: 'session-format-migration-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/session/session-format-v3-to-v4/README.zh.md',
    note: 'V3→V4 迁移边的权威规范：逐项表示变化、补齐规则、拒绝条件与原生 V4 接纳',
  },
  {
    id: 'session-format-version-current',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/session/src/types.ts',
    line: 89,
    note: 'SESSION_FORMAT_VERSION = 4：写入器版本的唯一手工维护处（0.1.7 起为 4）',
  },
  {
    id: 'session-format-version-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/core/session/src/types.ts',
    line: 88,
    note: 'SESSION_FORMAT_VERSION = 3：0.1.5 线的写入器版本（与 0.1.7 的 4 构成硬跳变）',
  },
  {
    id: 'manifest-fields-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 37,
    note: '0.1.5 的 dsh 清单：bundle.patch 是单字符串、profile.patchReload 存在，且仍有 configTrees / sessionFormatMigration / moduleFallback，无 manifestVersion / engines',
  },
  {
    id: 'agent-presets-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/preset/agent-presets/package.json',
    line: 2,
    note: '0.1.5 的 preset 包名是 @deepseek-ai/dsh-agent-presets（0.1.7 起拆成 agent-preset + agent-preset-registry）',
  },
  {
    id: 'settings-file-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/settings/settings-file',
    note: '0.1.5 存在 @deepseek-ai/dsh-settings-file；0.1.7 起该包消失',
  },
  {
    id: 'code-runtime-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/code-runtime/code-runtime/src/index.ts',
    line: 122,
    note: "0.1.5 的服务键是 codeRuntime（super(ctx, 'codeRuntime')）；0.1.7 起改名 ptcRuntime",
  },
  {
    id: 'tool-present-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/fs/tool-present',
    note: '0.1.5 的 @deepseek-ai/dsh-tool-present 在 fs 组；0.1.7 起搬到 deliverables 组，包名不变',
  },
  {
    id: 'ptc-runtime-service',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/ptc-runtime/ptc-runtime/src/index.ts',
    line: 134,
    note: "取代 codeRuntime 的服务键：super(ctx, 'ptcRuntime')（包名也从 dsh-code-runtime 改为 dsh-ptc-runtime）",
  },
  {
    id: 'agent-preset-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset/package.json',
    line: 2,
    note: '0.1.7 起的 preset 声明包（@deepseek-ai/dsh-agent-preset）',
  },
  {
    id: 'agent-preset-registry-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/preset/agent-preset-registry',
    note: '0.1.7 起的 preset 注册表包（@deepseek-ai/dsh-agent-preset-registry）',
  },
  {
    id: 'tool-present-moved',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/deliverables/tool-present',
    note: '与 fs 组下同名包是同一个 npm 名 @deepseek-ai/dsh-tool-present：只是目录搬家，对消费者无影响',
  },
  {
    id: 'config-editor-package',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/boot/config-editor',
    note: '0.1.5→0.1.7 期间新出现的配置面读写入口包',
  },
  {
    id: 'dump-config-schema-cli',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'apps/cli/src/dump-config-schema.ts',
    note: 'CLI 的 --dump-config-schema 实现（0.1.5 上没有该 flag）',
  },
  {
    id: 'loader-duplicate-id-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'vendor/loader/src/config/group.ts',
    line: 64,
    note: '0.1.5 的同 id 二次挂载会抛 TypeError `duplicate loader entry id: <id>`；0.1.7 起改为 last-wins 静默复用',
  },
  {
    id: 'base-hmr-row-0-1-5',
    source: 'deepseek-harness@dsh-v0.1.5-rc.3',
    path: 'packages/bundle/base/cordis.patch.yml',
    line: 22,
    note: "0.1.5 的 hmr 行是 `@deepseek-ai/cordis-plugin-hmr` + `disabled: true` + `root: ['.']`；0.1.7 起换成 `@deepseek-ai/dsh-hmr`、有 profileContext 即启用、`root: []`",
  },
  {
    id: 'client-boot-url-relative',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/modules/src/client/manifest.ts',
    line: 56,
    note: 'WebBootEntry.url 是 document-relative 的 combo 引用（0.1.5→0.1.7 期间从绝对端点改为相对文档）',
  },
  // plan #20：客户端面补页（静态插件取数通道 / 产物形态 / webServer 前缀与 seat 索引）。
  {
    id: 'client-platform-modules',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/web/src/platform.ts',
    note: 'PLATFORM_MODULES：shell 共享进冻结模块表的基线（react 三项 / cordis / store / ui-slots / ui-primitives / ui-dockkit）',
  },
  {
    id: 'client-bundle-module-loader',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/tsdown.client.ts',
    note: '客户端 bundle 产物形态 `window.__ModuleLoader__.load({ id, chunk?, factory })` 的生成处',
  },
  {
    id: 'ui-layout-rightbar-slot',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-layout/src/client/index.ts',
    note: 'root 作用域的 `rightbar` slot 声明与注册（右侧栏根容器）',
  },
  {
    id: 'sidebar-right-seats',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-sidebar-right/src/client/contract/slots.ts',
    note: '右侧边栏 seat 声明：pane.tab / pane.tab.title / tab.guide / tab.guide.entry / tab.menu.item 与 useTabInfo 信息面',
  },
  {
    id: 'sidebar-right-apply',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-sidebar-right/src/client/index.ts',
    note: '`rightbar`/`rightbar.session` 注册与子表声明，以及 sidebarRight / sidebarRightTabs 经 ctx.reflect.provide 提供服务面',
  },
  {
    id: 'sidebar-right-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-sidebar-right/README.md',
    note: '右侧边栏 seat 的官方叙述：类型两段式注册（sidebarRightTabs.register + slots.register）与 guide 条目',
  },
  {
    id: 'sidebar-right-seed',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-sidebar-right/src/client/contract/seed.ts',
    note: 'guide kind 与默认页解析（registered guide entry 数量决定默认页）',
  },
  {
    id: 'client-connection-api-request-trust',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/connection/src/api-request-trust.ts',
    note: '/api 的 Host 与 Origin 信任栅栏；plugin 自注册的 webServer 路由默认不走这道门',
  },
  {
    id: 'frontend-static-spa-fallback',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host/frontend-static/src/index.ts',
    note: 'SPA fallback 座位：未命中路由落到 dist 静态服务，文件不存在时回 404 空 body',
  },
  {
    id: 'tool-cordis-host-providers',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/extensions/tool-cordis/src/providers.ts',
    note: 'Host Inspect provider 集合：Service / Event / Config / Tool 及其精确输入（listConfigs 的 entry 与 name 分页）',
  },
  {
    id: 'subprocess-seam-scope',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/README.md',
    line: 12,
    note: 'seam 只拥有进程坐标与生命周期；argv 不经 shell 解释；默认值与渲染归 consumer（subprocess-and-trust.md §3）',
  },
  {
    id: 'subprocess-stdio-forms',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/README.md',
    line: 57,
    note: 'stdio 三形态：每流独立 pipe / inherit / collect（有界内存尾部 + 可选 spill）（subprocess-and-trust.md §3）',
  },
  {
    id: 'subprocess-spawn-spec',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/types.ts',
    line: 77,
    note: 'SubprocessSpawnSpec 逐字段契约（argv/cwd/stdio/graceMs/signal/env），无 mode/policy 字段，seam 不施加默认值',
  },
  {
    id: 'subprocess-collect',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/types.ts',
    line: 44,
    note: 'SubprocessCollect：maxBytes 溢出保留尾部；spill 缺席即不落盘，spill.maxBytes 是整流上限',
  },
  {
    id: 'subprocess-outcome',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/types.ts',
    line: 116,
    note: 'SubprocessOutcome 只给 exitCode/signal，不分类超时或取消（deadline 归 consumer）',
  },
  {
    id: 'subprocess-output-read',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/types.ts',
    line: 124,
    note: 'readFrom 的 {text,nextOffset,lossy,spillPath} 语义：cursor-free 偏移，游标滑出尾部时 lossy',
  },
  {
    id: 'subprocess-handle',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/types.ts',
    line: 169,
    note: 'SubprocessHandle 面：collected / done / terminate（幂等）/ waitForExit（无法观察时 throw）',
  },
  {
    id: 'subprocess-env-scrub',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/index.ts',
    line: 47,
    note: 'SENSITIVE_ENV_PATTERN 与 DSH_* 的 ambient scrub；显式 env 在 scrub 之后合并（逃生口）',
  },
  {
    id: 'subprocess-resolve-executable',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess/src/index.ts',
    line: 133,
    note: 'resolveExecutable(command,env?,signal?)：绝对路径校验、裸名走 scrub 后 PATH、含分隔符的相对路径直接失败',
  },
  {
    id: 'subprocess-local-owners',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subprocess/subprocess-local/README.md',
    line: 86,
    note: 'provider 按 spawn 选原生进程 owner（systemd scope / Windows Job / POSIX PGID）；该 provider 无沙箱概念',
  },
  {
    id: 'bash-local-spawn-spec',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/bash-local/src/index.ts',
    line: 151,
    note: 'spawnSpec 的 collect+spill 范式、graceMs（SIGTERM→SIGKILL）与 env 分层 {...ENV_OVERRIDES,...spec.env,...spec.dshEnv}',
  },
  {
    id: 'tool-bash-render-conventions',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/tool-bash/src/render.ts',
    line: 44,
    note: '渲染惯例：body → [stderr] → markers；[exit code: N] 必须末位（parseExitStatus 锚点）；截断提示 [output truncated; …]',
  },
  {
    id: 'shell-parse-exit-status',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/shell/src/render.ts',
    line: 37,
    note: 'parseExitStatus 的 end-anchored 正则（[killed by signal: X] / [exit code: N]），要求前置 \\n',
  },
  {
    id: 'sandbox-writable-roots',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/sandbox/sandbox/src/roots.ts',
    line: 52,
    note: 'writableRoots = workspaceRoot + /tmp + tmpdir()；没有「额外可写根」配置（信任模型的关键事实）',
  },
  {
    id: 'bash-sandbox-consumer-confines',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/bash-sandbox/README.md',
    line: 78,
    note: "confinement 由 consumer 施加：对 ['bash','-c',cmd] 调 ctx.sandbox.confine() 并 spawn 返回的 argv；fail-closed、仅文件效果",
  },
  {
    id: 'sandbox-confine-seam',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/sandbox/sandbox/src/index.ts',
    line: 177,
    note: 'confine(argv,policy,signal) 的 seam 契约：调用方 spawn 返回的 argv；SandboxMode 与 SANDBOX_UNAVAILABLE',
  },
  {
    id: 'jobs-job-output-source',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/jobs/src/types.ts',
    line: 55,
    note: 'JobOutputSource / JobSourceRead：后台作业的 pull 形状 {channel, read(fromByte)}',
  },
  {
    id: 'tool-bash-background-adapter',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/tool-bash/src/background.ts',
    line: 67,
    note: 'processSources()/processOutcome()：collected reader → ctx.jobs pull source / JobOutcome 的范本',
  },
  {
    id: 'permission-presets-pairing',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/permission-presets/README.md',
    line: 32,
    note: 'preset = 一个 sandbox mode + 一个 approval policy；插件的信任姿态最终由 profile 的 preset 决定',
  },
  {
    id: 'user-approval-policy-outcomes',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-approval/src/index.ts',
    line: 67,
    note: 'ApprovalPolicy 为 ask|never；outcome 四值 allowed-once|rejected|cancelled|unavailable，只有 allowed-once 是授权',
  },
  {
    id: 'user-approval-model-sentences',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-approval/src/index.ts',
    line: 73,
    note: 'NEVER_SENTENCE / ASK_SENTENCE：never 下明说不要请求提权；ask 下明说无 answerer 时 fail closed',
  },
  {
    id: 'user-approval-open-turn',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-approval/src/index.ts',
    line: 217,
    note: 'turn 外调用 request() 直接抛（原文），审计对必须被 turn 包住，否则 reload 当 crash tail 丢弃',
  },
  {
    id: 'user-approval-audit-pair',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-approval/src/index.ts',
    line: 225,
    note: 'approval/asked {id,toolName,callId?,reason?} 与 approval/decided {id,outcome} 的 log-only 审计对',
  },
  {
    id: 'user-approval-types',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-approval/src/types.ts',
    line: 63,
    note: 'ApprovalRequest 字段（agent/toolName 必填，callId/reason/displayReason/signal 可选）与 approval/request waterfall、approval/policy 覆盖',
  },
  {
    id: 'cordis-event-prepend',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/events.ts',
    line: 112,
    note: 'ctx.on 的 { prepend: true }：插到既有监听器之前（unshift），用于包裹别人的审批询问',
  },
  {
    id: 'tool-bash-escalation-flow',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/shell/tool-bash/README.md',
    line: 68,
    note: 'denial 标记、同轮次一次重试、sandbox_permissions/justification 的出现与配对规则、批准才执行',
  },
  {
    id: 'tools-pretool-decision-ask',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 607,
    note: 'PreToolDecision 四值（含 ask）；ask 只有 approval 返回 allowed-once 才执行，否则拒绝',
  },
  {
    id: 'tools-approval-ask-mapping',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 1734,
    note: 'core 对 ask 的兜底：无 approval 服务 / 无 agent 两条拒绝文案，四值映射到固定结果文本',
  },
  {
    id: 'sandbox-escalation-markers',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/sandbox/sandbox/src/escalation.ts',
    line: 71,
    note: 'denial 标记 [sandbox: file access denied under <mode> mode] 与 escalation hint 的字节级文案',
  },
  {
    id: 'auto-review-alternative',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/experimental/auto-review/README.md',
    line: 12,
    note: 'LLM 逐次复核路线的自述代价：可能放行危险操作、每次多一次不进缓存的模型请求、无确定性豁免',
  },
  {
    id: 'user-questions-seam',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-questions/README.md',
    line: 12,
    note: '需要用户结构化回答时走 ctx.userQuestions.ask；插件不要自造对话框 UI',
  },
  {
    id: 'cordis-scoped-inject',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/registry.ts',
    line: 300,
    note: 'ctx.inject(deps, cb) ≡ plugin({ inject, apply: cb })：作用域子能力可选，服务缺失时整块静默不激活',
  },
  {
    id: 'cordis-get-strict',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'vendor/cordis/src/reflect.ts',
    line: 233,
    note: 'ctx.get(name, strict = true) 只返回 provider 当前 active 的服务，是可选服务的读法',
  },
  {
    id: 'tool-definition-timeout',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 266,
    note: 'ToolDefinition.timeoutMs 是协作式超时预算，永不发给模型（schemas 只白名单 name/description/parameters）',
  },
  // plan #25：references/dsh/delegation-and-parallelism.md（委派通道、并行层次、context 语义）引用的上游事实。
  {
    id: 'subagent-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/subagent.zh.md',
    note: '委派 seam 全文：provider 能力旗标、可继续子级与 Activation、权限/深度/fork 种子语义、Cordis API',
  },
  {
    id: 'workflow-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/workflow.zh.md',
    note: 'workflow seam：启动请求、WorkflowMeta、失败纪律（fatal 抛出 vs 逐项 null）与事件隔离',
  },
  {
    id: 'tool-subagent-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/tool-subagent/README.zh.md',
    line: 165,
    note: '工具面：provider/toolName/backgroundMode/enableRunInBackground 字段、前台与后台两套结算、系统提示词节文案',
  },
  {
    id: 'tool-subagent-control-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/tool-subagent-control/README.zh.md',
    note: '三个控制工具：send_message 只允许直接父级/直接可继续子级，interrupt_agent 保留 inbox 与后代，list_agents 的 running/inactive 不代表完成',
  },
  {
    id: 'tool-subagent-concurrency-safe',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/tool-subagent/src/index.ts',
    line: 470,
    note: '所有调用形态都声明 isConcurrencySafe: () => true，因此同一条 assistant message 里的兄弟委派进 loop 并行池',
  },
  {
    id: 'tool-subagent-background-default',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/tool-subagent/src/index.ts',
    line: 303,
    note: '后台默认值取自 run_in_background ?? continuable：continuable 实例省略参数即后台，one-shot 实例保持前台默认',
  },
  {
    id: 'tool-subagent-guidance-section',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/tool-subagent/src/index.ts',
    line: 603,
    note: '系统提示词节只在 enableRunInBackground + continuable 且工具在 scope 内时注入，文本由 toolName 插值',
  },
  {
    id: 'agent-loop-tool-call-pool',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent-loop/src/tool-calls.ts',
    line: 132,
    note: '一个 step 的 tool call 按 isConcurrencySafe 分类（fail-closed 成 exclusive）、进有上限的滚动池，结果仍按模型顺序提交',
  },
  {
    id: 'agent-loop-parallel-default',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent-loop/src/constants.ts',
    line: 6,
    note: 'DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10（loop 配置 maxParallelToolCalls 的默认值）',
  },
  {
    id: 'subagent-host-config',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent/src/index.ts',
    line: 202,
    note: 'ctx.subagents 的 Config：maxDepth 默认 1（0 禁止委派）、maxActiveSubagents 默认 8（在线 continuable 子级上限）',
  },
  {
    id: 'subagent-fork-seed',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent-fork-in-process/src/index.ts',
    line: 51,
    note: 'fork 种子 = 以最后一个 turn/end 为边界的已完成轮次前缀；进行中的回合被排除，之后父级新内容不再到达子级',
  },
  {
    id: 'workflow-ptc-config',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/workflow-ptc/src/index.ts',
    line: 107,
    note: '引擎 Config：maxConcurrentAgents 默认 0（取 min(16, 可用并行度-2)）、maxTotalAgents 1000、maxItemsPerCall 4096',
  },
  {
    id: 'tool-workflow-no-concurrency-declaration',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/tool-workflow/src/index.ts',
    note: '该包未声明 isConcurrencySafe，故 workflow 调用是独占屏障（与 tool-subagent 的声明相反）',
  },
  {
    id: 'web-preset-delegation-group',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/bundle/web-app/presets/standard.patch.yml',
    line: 90,
    note: '随产品装配的 delegation 组：subagent=spawn+continuable+modelSelection、subagent_fork=fork+continuable，codex/claude-code 行默认 disabled',
  },
  {
    id: 'parallel-subagent-delegations-note',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: '.agents/notes/archived/feature/2026-08-09-parallel-subagent-delegations.md',
    note: '兄弟委派为何被声明为并发安全、容量归属（池位 vs 在线子级）与工作区竞争责任的归档记录，只作背景',
  },
  // plan #26：同一页的「等待与收尾」节（禁 sleep 轮询）引用的上游事实。
  {
    id: 'tool-jobs-guidance-section',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/tool-jobs/src/index.ts',
    line: 253,
    note: 'job_* 的系统提示词原文：do not busy-poll or sleep on one；收尾用 job_output（只在真被阻塞时 wait: true）与 job_kill',
  },
  {
    id: 'tool-jobs-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/jobs/tool-jobs/README.zh.md',
    note: '等待与通知语义：wait 默认 30s / 上限 600s、超时保持 running、完成通知文案与 busy/idle 投递、awaited 不重复通知、completionDelivery 与 maxConsecutiveWakes',
  },
  // plan #27：同一页的「在 plan mode 里委派」节（子级不能发起人机交互）引用的上游事实。
  {
    id: 'user-questions-root-only',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-questions/src/index.ts',
    line: 140,
    note: 'assertLiveRoot：只有运行时根 agent 能发起人机交互；存活子级以 DELEGATED_CALLER 被拒，文案指引把未决问题写进子级最终结果',
  },
  {
    id: 'user-questions-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/interaction/user-questions/README.zh.md',
    note: 'ask / askTimed 契约、plan-review intent、存活子级不能发起人机交互、答案 Remote 的根 agent 要求',
  },
  {
    id: 'plan-mode-exit-tool',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/plan/plan-mode/src/index.ts',
    line: 297,
    note: 'exit_plan_mode 要求调用者自己的 session 处于 plan mode，随后经 ctx.userQuestions 走 plan-review 人机交互评审',
  },
  {
    id: 'plan-mode-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/plan/plan-mode/README.zh.md',
    note: 'plan mode 是提示词层软约束（每个工具仍可用，强制靠沙箱/审批）、/plan 命令、评审退出与投影状态',
  },
  {
    id: 'plan-subsystem-doc',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'docs/subsystems/plan.zh.md',
    note: 'plan/mode 是仅记日志的整值替换事件：恢复、fork 与 compaction 都从日志折叠出状态',
  },
  {
    id: 'agent-registry-roots',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/core/agent/src/index.ts',
    line: 598,
    note: 'AgentRegistry.roots() = registry 中 owner 为 undefined 的 agent；子级因带 owner 而不是根',
  },
  // plan #28：同一页的「咨询循环」节（子级提问 → 父级问用户 → 父级回投）引用的上游事实。
  {
    id: 'subagent-settlement-message',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent/src/continuation-messages.ts',
    line: 135,
    note: '结算通知就是一条 user/message：summary + 「Its closing message:」+ 子级最终非空文本块（没有则 It left no closing message.），source.kind = subagent-settled',
  },
  {
    id: 'subagent-not-resumable',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent/src/control.ts',
    line: 74,
    note: '浏览器 prompt 通道对不可冷恢复的目标（一次性 / 未知子级）以 subagent/not-resumable 拒绝',
  },
  // plan #29：新页 host-to-client-channel 与 e2e-verification-recipe 引用的上游事实。
  {
    id: 'webserver-index-inject-event',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/host/webserver/src/index.ts',
    line: 34,
    note: 'webserver/index-inject 事件声明：每次 index 渲染 / worker boot 载荷请求各 emit 一次，订阅者把当前行 push 进可变表',
  },
  {
    id: 'client-page-injection-interpreter',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/web/src/apply-injections.ts',
    note: '页面侧解释器：global / script / script-src / style / html 行按表顺序执行，global 行在脚本之前生效',
  },
  {
    id: 'client-shortcuts-host-injection',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/shortcuts/src/index.ts',
    line: 16,
    note: '官方先例：宿主半边直接 ctx.on(webserver/index-inject) 推 global 行 __DSH_SHORTCUTS_CONFIG__，不查 webserver 服务',
  },
  {
    id: 'client-settings-models-host-injection',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-settings-models/src/index.ts',
    line: 14,
    note: '第二个官方先例：宿主 apply 里直接 ctx.on(webserver/index-inject) 推 __DSH_MODELS_ONBOARDING__',
  },
  {
    id: 'client-theme-prepend-injection',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-theme/src/index.ts',
    line: 43,
    note: '注入行顺序即执行顺序：官方用 { prepend: true } 把行塞到表首，保证全局/样式先于读它的脚本',
  },
  {
    id: 'shortcuts-fixed-input-observer',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/shortcuts/src/client/types.ts',
    line: 101,
    note: 'observeFixedInput：观察按固定序列本地仲裁后的输入，是「提示卡上补键盘行为」唯一受支持的接入点',
  },
  {
    id: 'shortcuts-dom-install',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/shortcuts/src/client/dom.ts',
    line: 31,
    note: 'installKeyboard：window 级 bubble 监听，先喂本地固定观察者再走命令 dispatch；事件来自 realm 全局 window 而非服务',
  },
  // plan #89：references/develop/subagent-provider.md 与 modules/subagent.md、modules/workflow.md 引用的上游事实。
  {
    id: 'subagent-group-root',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent',
    note: '模块页与索引把该组当作一个整体引用（组根路径本身没有契约，职责表以 packages/subagent/README.zh.md 为准）',
  },
  {
    id: 'workflow-group-root',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow',
    note: '模块页与索引把该组当作一个整体引用（组根路径本身没有契约，职责表以 packages/workflow/README.zh.md 为准）',
  },
  {
    id: 'subagent-package-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/README.zh.md',
    note: 'subagent 组一张表：服务 + 六个 provider + 两个工具包的职责与 ctx 键，是模块页「包 / 对外提供」表的来源',
  },
  {
    id: 'subagent-provider-contract-types',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent/src/types.ts',
    line: 130,
    note: 'SubagentCapabilities 五旗标与 SubagentStartRequest 字段一一对应；SubagentProvider 的 name/capabilities/inheritsParentContext/agentRouteDefaults/start 与 prepareContinuable（方法存在即能力、seed 契约）的原始出处',
  },
  {
    id: 'subagent-service-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent/README.zh.md',
    note: '服务契约全文：provider 注册表与两种子级形态、发布即所有权边界、注册受 effect 作用域约束（移除只阻断新启动）、maxActiveSubagents 容量与 ACTIVATION_LIMIT_REACHED',
  },
  {
    id: 'subagent-spawn-provider-minimal',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/subagent/subagent-spawn-in-process/src/index.ts',
    note: '最小 provider 范式：五旗标全 true、inheritsParentContext = false、空 seed 的 prepareContinuable、apply 里 ctx.subagents.registerProvider',
  },
  {
    id: 'workflow-package-group-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/README.zh.md',
    note: 'workflow 组一张表：workflow（Definition）/ workflow-ptc（引擎）/ tool-workflow / tool-ralph 的职责与 ctx 键',
  },
  {
    id: 'workflow-engine-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/workflow/README.zh.md',
    note: 'engine 契约：一个上下文同时只有一个引擎、run 归持有者且 result 永不 reject、workflow/* 事件只供观察',
  },
  {
    id: 'workflow-ptc-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/workflow-ptc/README.zh.md',
    note: 'PTC 引擎：Config 字段、Python PTC 组合必须禁用本引擎与 tool-workflow/tool-ralph、取消会中止受管进程与子 agent',
  },
  {
    id: 'tool-workflow-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/tool-workflow/README.zh.md',
    note: 'workflow 工具面：meta/script/args 三参、前台包络与结果渲染、toolName/maxResultChars 配置、父级轮次阻塞到运行结算',
  },
  {
    id: 'tool-ralph-readme',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/workflow/tool-ralph/README.zh.md',
    note: 'ralph 工具：固定前台的全新 agent 序列、Round 报告校验与上限、要求 provider 支持结构化输出且 inheritsParentContext: false',
  },
];

/** A fact that cannot be re-verified because its reference tree is missing. */
interface PendingFact {
  id: string;
  source: string;
  path: string;
}

/**
 * How much of the ledger the local checkout can actually re-verify.
 *
 * A checkout carries exactly one dsh revision, but the ledger deliberately
 * pins several (current content plus history pages). So re-verification is
 * per-revision: facts pinned to the checkout's own revision are checked,
 * facts pinned to another revision are skipped — never failures. Authoring
 * and reviewing those history pages is a manual discipline (see
 * `notes/skill-design.md` §6); the alternative, several checkouts side by
 * side, is explicitly out of scope.
 */
interface ReferenceCensus {
  /** Checkout present and pinned to the same revision — checked for real. */
  available: Fact[];
  /** No checkout for that repo at all (the normal case outside development). */
  pending: PendingFact[];
  /** Checkout present, but this fact is pinned to another revision. */
  unverifiable: Fact[];
}

/** Split the ledger by what the checkout under `referenceRoot` can verify. */
function referenceCensus(referenceRoot: string = R3P_DIR): ReferenceCensus {
  const census: ReferenceCensus = { available: [], pending: [], unverifiable: [] };
  for (const fact of facts) {
    const reference = REFERENCES[repoOf(fact.source)];
    if (reference === undefined) {
      census.pending.push(fact);
      continue;
    }
    const dir = join(referenceRoot, reference.dir);
    const packageJson = join(dir, reference.packageJson);
    if (!existsSync(packageJson)) {
      census.pending.push(fact);
      continue;
    }
    const declared = (JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: string })
      .version;
    if (declared === versionFromTag(fact.source)) {
      census.available.push(fact);
    } else {
      census.unverifiable.push(fact);
    }
  }
  return census;
}

/** Throwaway checkouts for the revision-matching tests. */
const tempCheckouts: string[] = [];

/** A fake checkout root whose `deepseek-harness` copy declares `version`. */
function fakeReferenceRoot(version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-facts-test-'));
  tempCheckouts.push(root);
  const dir = join(root, 'deepseek-harness');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  return root;
}

afterAll(() => {
  for (const root of tempCheckouts.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Every ledger revision, sorted. */
function pinnedVersions(): string[] {
  return [...new Set(facts.map((fact) => versionFromTag(fact.source)))].sort();
}

/** Ids of the facts pinned to `version`. */
function idsPinnedTo(version: string): string[] {
  return facts
    .filter((fact) => versionFromTag(fact.source) === version)
    .map((fact) => fact.id)
    .sort();
}

function repoOf(source: string): string {
  return source.slice(0, source.lastIndexOf('@'));
}

function tagOf(source: string): string {
  return source.slice(source.lastIndexOf('@') + 1);
}

/** Tag → the version its checkout's package.json should declare. */
function versionFromTag(source: string): string {
  return tagOf(source).replace(/^[a-z0-9._-]+-v/, '');
}

/** Inside the reference tree, never out of it: guards accidental `../` paths. */
function assertSafePath(fact: Fact): void {
  const inside = relative(R3P_DIR, join(R3P_DIR, fact.path));
  const escapes = inside === '' || inside.startsWith('..') || isAbsolute(inside);
  expect(escapes, `fact "${fact.id}" path escapes 3rdp/: ${fact.path}`).toBe(false);
}

/**
 * Every markdown page under `skill/`, as `/`-joined paths relative to `skill/`
 * (e.g. `SKILL.md`, `references/dsh/index.md`).
 */
function skillPages(): string[] {
  return readdirSync(SKILL_DIR, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.split(sep).join('/'))
    .sort();
}

/** Every directory under `skill/`, `/`-joined and relative to `skill/`. */
function skillDirs(pages: string[]): string[] {
  const dirs = new Set<string>();
  for (const page of pages) {
    const parts = page.split('/');
    parts.pop();
    while (parts.length > 0) {
      dirs.add(parts.join('/'));
      parts.pop();
    }
  }
  return [...dirs].sort();
}

/** Every upstream path cited anywhere under `skill/`. */
function citedPaths(): string[] {
  const cited = new Set<string>();
  for (const page of skillPages()) {
    const text = readFileSync(join(SKILL_DIR, page), 'utf8');
    for (const match of text.matchAll(CITED_PATH_SHAPE)) {
      cited.add(match[0].replace(/:\d+(?:-\d+)?$/, '').replace(/\/$/, ''));
    }
  }
  return [...cited].sort();
}

/** In-skill links on a page, as `/`-joined paths relative to `skill/`. */
function linksOn(page: string): string[] {
  const text = readFileSync(join(SKILL_DIR, page), 'utf8');
  return [...new Set(text.match(REFERENCE_LINK_SHAPE) ?? [])].sort();
}

/**
 * The pages `SKILL.md` must name — and name only: every top-level
 * `references/*.md` plus every 大类 index (`references/<dir>/index.md`).
 * Deeper pages hang off their own directory index, so adding one never edits L0.
 */
function entryPages(pages: string[]): string[] {
  return pages
    .filter((page) => {
      const parts = page.split('/');
      if (page === ENTRY_PAGE || parts[0] !== 'references') return false;
      return parts.length === 2 || (parts.length === 3 && parts[2] === 'index.md');
    })
    .sort();
}

/** Parent of a `/`-joined directory path (`''` for `references/`). */
function dirnameOf(dir: string): string {
  const parts = dir.split('/');
  parts.pop();
  return parts.join('/');
}

/** The index page of a directory; the root of `skill/` is `SKILL.md`. */
function dirIndex(dir: string): string {
  return dir === '' ? ENTRY_PAGE : `${dir}/index.md`;
}

/** The pages and child indexes a directory's `index.md` must name. */
function dirMembers(dir: string, pages: string[]): string[] {
  const prefix = `${dir}/`;
  const pagesHere = pages.filter((page) => {
    if (page === dirIndex(dir) || !page.startsWith(prefix)) return false;
    return !page.slice(prefix.length).includes('/');
  });
  const childIndexes = skillDirs(pages)
    .filter((child) => child !== dir && dirnameOf(child) === dir)
    .map(dirIndex);
  return [...pagesHere, ...childIndexes].sort();
}

/**
 * The index page a page must link back to: a content page points at its own
 * directory index, an index page at the index one level up, and the top-level
 * 大类 indexes back at `SKILL.md`.
 */
function parentIndex(page: string): string {
  const parts = page.split('/');
  const name = parts.pop();
  if (parts.length === 0 || name === undefined) return '';
  if (name === 'index.md') {
    parts.pop();
    return parts.length <= 1 ? ENTRY_PAGE : `${parts.join('/')}/index.md`;
  }
  return parts.length === 1 && parts[0] === 'references'
    ? ENTRY_PAGE
    : `${parts.join('/')}/index.md`;
}

/** `page -> link` pairs whose target does not exist. */
function deadLinks(pages: string[]): string[] {
  const known = new Set(pages);
  const dead: string[] = [];
  for (const page of pages) {
    for (const link of linksOn(page)) {
      if (!known.has(link)) dead.push(`${page} -> ${link}`);
    }
  }
  return dead.sort();
}

/** Pages reachable from `SKILL.md` by following in-skill links (cycles ok). */
function reachablePages(pages: string[]): Set<string> {
  const known = new Set(pages);
  const seen = new Set<string>([ENTRY_PAGE]);
  const queue = [ENTRY_PAGE];
  while (queue.length > 0) {
    const page = queue.pop();
    if (page === undefined) continue;
    for (const link of linksOn(page)) {
      if (known.has(link) && !seen.has(link)) {
        seen.add(link);
        queue.push(link);
      }
    }
  }
  return seen;
}

/** Paths whose segments break the lowercase kebab-case contract. */
function badNames(pages: string[], dirs: string[]): string[] {
  const bad = new Set<string>();
  for (const dir of dirs) {
    for (const segment of dir.split('/')) {
      if (!PAGE_SEGMENT_SHAPE.test(segment)) bad.add(dir);
    }
  }
  for (const page of pages) {
    if (page === ENTRY_PAGE) continue;
    const segments = page.split('/');
    const stem = (segments[segments.length - 1] ?? '').replace(/\.md$/, '');
    for (const segment of [...segments.slice(0, -1), stem]) {
      if (!PAGE_SEGMENT_SHAPE.test(segment)) bad.add(page);
    }
  }
  return [...bad].sort();
}

describe('fact ledger metadata', () => {
  it('is non-empty and has unique slugs', () => {
    expect(facts.length).toBeGreaterThan(0);
    const ids = facts.map((fact) => fact.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names a known reference and a versioned revision for every fact', () => {
    for (const fact of facts) {
      expect(fact.source, `fact "${fact.id}"`).toMatch(SOURCE_SHAPE);
      expect(REFERENCES[repoOf(fact.source)], `fact "${fact.id}" reference`).toBeDefined();
    }
  });

  it('keeps every upstream path inside the reference tree', () => {
    for (const fact of facts) {
      assertSafePath(fact);
    }
  });

  it('gives every fact a note, and a positive line when anchored', () => {
    for (const fact of facts) {
      expect(fact.note.trim(), `fact "${fact.id}" note`).not.toBe('');
      if (fact.line !== undefined) {
        expect(fact.line, `fact "${fact.id}" line`).toBeGreaterThan(0);
      }
    }
  });

  it('covers every upstream path the skill cites', () => {
    const ledger = new Set(facts.map((fact) => fact.path));
    const uncovered = citedPaths().filter((cited) => !ledger.has(cited));
    expect(
      uncovered,
      'skill cites upstream paths that are missing from the fact ledger (add a fact for each)'
    ).toEqual([]);
  });

  it('indexes every entry page from SKILL.md, and nothing else', () => {
    // L0 stays a thin, version-neutral index: growing a category adds a
    // `references/<dir>/index.md`, never a link onto SKILL.md itself.
    expect(linksOn(ENTRY_PAGE), 'SKILL.md index').toEqual(entryPages(skillPages()));
  });

  it('keeps every directory index in step with the pages it owns', () => {
    const pages = skillPages();
    // `references/` itself is indexed by `SKILL.md` — see the entry test above.
    const dirs = skillDirs(pages).filter((dir) => dir !== 'references');
    for (const dir of dirs) {
      const index = dirIndex(dir);
      expect(existsSync(join(SKILL_DIR, index)), `${dir} needs ${index}`).toBe(true);
      // Names all its members (so none is orphaned); extra cross-category
      // links are allowed and checked for existence below.
      expect(linksOn(index), `${index} index`).toEqual(
        expect.arrayContaining(dirMembers(dir, pages))
      );
    }
  });

  it('links only to pages that exist', () => {
    expect(deadLinks(skillPages())).toEqual([]);
  });

  it('reaches every page from SKILL.md', () => {
    const pages = skillPages();
    const reachable = reachablePages(pages);
    expect(
      pages.filter((page) => !reachable.has(page)),
      'unreachable pages'
    ).toEqual([]);
  });

  it('gives every page a backlink to the index that owns it', () => {
    const missing = skillPages()
      .filter((page) => page !== ENTRY_PAGE)
      .filter((page) => !readFileSync(join(SKILL_DIR, page), 'utf8').includes(parentIndex(page)));
    expect(missing, 'pages that never name their parent index').toEqual([]);
  });

  it('names every page and directory in lowercase kebab-case', () => {
    const pages = skillPages();
    expect(badNames(pages, skillDirs(pages))).toEqual([]);
  });

  it('keeps SKILL.md free of version-bound content', () => {
    // L0 is the one page that must survive a dsh major version untouched:
    // upstream paths, version literals and `<repo>@<tag>` pins all belong to
    // the pages below it (see notes/skill-design.md §2).
    const text = readFileSync(join(SKILL_DIR, ENTRY_PAGE), 'utf8');
    expect(text.match(CITED_PATH_SHAPE) ?? [], 'SKILL.md cites upstream paths').toEqual([]);
    expect(text.match(SEMVER_SHAPE), 'SKILL.md carries a version literal').toBeNull();
    expect(text.match(VERSION_PIN_SHAPE), 'SKILL.md carries a <repo>@<tag> pin').toBeNull();
  });

  it('pins every content page to a reference revision', () => {
    // Index pages are navigation and carry no facts, so they need no pin.
    const unpinned = skillPages()
      .filter((page) => page.startsWith('references/') && !page.endsWith('/index.md'))
      .filter((page) => {
        const text = readFileSync(join(SKILL_DIR, page), 'utf8');
        return (text.match(PIN_IN_PROSE_SHAPE) ?? []).length === 0;
      });
    expect(unpinned, 'content pages without a <repo>@<tag> pin').toEqual([]);
  });

  it('declares the current baseline in exactly one page', () => {
    const offenders = skillPages()
      .filter((page) => page !== BASELINE_OWNER)
      .filter((page) => BASELINE_CLAIM_SHAPE.test(readFileSync(join(SKILL_DIR, page), 'utf8')));
    expect(offenders, `pages other than ${BASELINE_OWNER} claiming a baseline`).toEqual([]);
  });

  it('keeps the English ↔ 中文 term table on the concept page only', () => {
    const concept = readFileSync(join(SKILL_DIR, BILINGUAL_TERM_PAGE), 'utf8');
    expect(
      concept.match(BILINGUAL_HEADER_SHAPE) ?? [],
      `${BILINGUAL_TERM_PAGE} needs an "English | 中文" term-table header`
    ).not.toEqual([]);
    const offenders = skillPages()
      .filter((page) => page !== BILINGUAL_TERM_PAGE)
      .filter((page) => BILINGUAL_HEADER_SHAPE.test(readFileSync(join(SKILL_DIR, page), 'utf8')));
    expect(offenders, 'pages duplicating the bilingual term table').toEqual([]);
  });

  it('pins every content page to a revision the ledger knows', () => {
    // A provenance pin must name a revision the ledger actually tracks, so a
    // stale pin (a baseline no fact carries any more) fails loudly instead of
    // silently skipping re-verification (notes/skill-design.md §4.1). History
    // pages may also name older revisions; one known pin is enough for them.
    const known = new Set(facts.map((fact) => tagOf(fact.source)));
    const offenders = skillPages()
      .filter((page) => page.startsWith('references/') && !page.endsWith('/index.md'))
      .filter((page) => {
        const text = readFileSync(join(SKILL_DIR, page), 'utf8');
        const pins = (text.match(PIN_IN_PROSE_SHAPE) ?? []).filter(
          (pin) => REFERENCES[pin.slice(0, pin.indexOf('@'))] !== undefined
        );
        return !pins.some((pin) => known.has(pin.slice(pin.indexOf('@') + 1)));
      });
    expect(offenders, 'content pages whose pin names no ledger revision').toEqual([]);
  });

  it('makes every placeholder name the plan that fills it', () => {
    const offenders: string[] = [];
    for (const page of skillPages()) {
      const lines = readFileSync(join(SKILL_DIR, page), 'utf8').split('\n');
      for (const [index, line] of lines.entries()) {
        if (line.includes(PLACEHOLDER_MARKER) && !PLACEHOLDER_PLAN_SHAPE.test(line)) {
          offenders.push(`${page}:${index + 1}`);
        }
      }
    }
    expect(offenders, 'placeholder markers without "plan #<id>"').toEqual([]);
  });
});

describe('fact ledger re-verification', () => {
  // Computed once: whether the vendored checkout is here is a property of the
  // machine, not of test order.
  const local = referenceCensus();

  it('finds nothing to re-verify when the reference tree is absent (the normal case)', () => {
    const absent = referenceCensus(join(ROOT, 'no-such-reference-tree'));
    expect(absent.available).toEqual([]);
    expect(absent.unverifiable).toEqual([]);
    expect(absent.pending.map((fact) => fact.id).sort()).toEqual(
      facts.map((fact) => fact.id).sort()
    );
  });

  it('re-verifies exactly the facts pinned to the local checkout revision', () => {
    // A checkout at a revision nothing pins: every fact is skipped, none fails.
    const unknown = referenceCensus(fakeReferenceRoot('9.9.9'));
    expect(unknown.available).toEqual([]);
    expect(unknown.pending).toEqual([]);
    expect(unknown.unverifiable.map((fact) => fact.id).sort()).toEqual(
      facts.map((fact) => fact.id).sort()
    );

    // A checkout at a pinned revision: that revision's facts, and only those.
    for (const version of pinnedVersions()) {
      const census = referenceCensus(fakeReferenceRoot(version));
      expect(census.available.map((fact) => fact.id).sort()).toEqual(idsPinnedTo(version));
      expect(census.pending).toEqual([]);
      expect(census.unverifiable.map((fact) => fact.id).sort()).toEqual(
        facts
          .filter((fact) => versionFromTag(fact.source) !== version)
          .map((fact) => fact.id)
          .sort()
      );
    }
  });

  it('agrees with the vendored reference when it is present', () => {
    // Local development only: without 3rdp/ there is nothing to re-check, and
    // that is the normal case in test/production. No warning is emitted — a
    // missing checkout is expected, not a problem to report.
    if (local.available.length === 0) {
      return;
    }

    const failures: string[] = [];

    for (const fact of local.available) {
      const reference = REFERENCES[repoOf(fact.source)];
      if (reference === undefined) continue;
      const absolute = join(R3P_DIR, reference.dir, fact.path);
      if (!existsSync(absolute)) {
        failures.push(`${fact.id} (${fact.source}): missing ${fact.path}`);
        continue;
      }
      if (fact.line === undefined) continue;
      const lineCount = readFileSync(absolute, 'utf8').split('\n').length;
      if (fact.line > lineCount) {
        failures.push(
          `${fact.id} (${fact.source}): line ${fact.line} is past the end of ${fact.path} (${lineCount} lines)`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('sees the vendored checkout when it is present', () => {
    // Guards against the census silently classifying everything as "no
    // checkout": on a machine that does have 3rdp/, some facts must be
    // accounted for — even when every one of them is pinned to another revision.
    if (!existsSync(R3P_DIR)) {
      return;
    }
    expect(local.pending.length, 'checkout is here but nothing was seen').toBeLessThan(
      facts.length
    );
  });
});
