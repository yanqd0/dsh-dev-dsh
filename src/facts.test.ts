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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/skill/skill-filesystem/src/index.ts',
    line: 797,
    note: 'SKILL.md frontmatter 只要求 name / description，其余字段可选（whenToUse 等）',
  },
  {
    id: 'creator-skills-dir',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/preset/agent-preset/skills',
    note: '官方 Creator mode 自带的三个 creator skill 所在目录（本 skill 不重复它们的内容）',
  },
  {
    id: 'agent-preset-doc',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/preset/agent-preset/README.md',
    line: 50,
    note: 'agent-preset 与其 skills/ 的说明出处',
  },
  {
    id: 'client-bundle-preset',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/client/tsdown.client.ts',
    note: '官方 client bundle 构建 preset（未随 npm 发布，仓外自行复现——0.2.0 门类）',
  },
  {
    id: 'client-module-table-baseline',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/client/web/src/platform.ts',
    note: 'web module table 的外部化基线（externals 取此处）',
  },
  {
    id: 'client-bundle-cookbook',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'docs/cookbook/adding-a-settings-card.md',
    note: '官方 cookbook 明说仓外包自行复现 client 构建',
  },
  {
    id: 'client-resource-protocol-parse',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/client/resources/src/client/resources.ts',
    line: 67,
    note:
      'protocolOf() 用 new URL(address).hostname 取资源类型；Chromium 对 dsh-resource://file/… ' +
      '给空 hostname（file 是特殊 scheme 名），Node 给 "file" ⟹ 浏览器里文件/计划预览报「不可用」。' +
      '见 references/client-console-diagnosis.md',
  },
  {
    id: 'out-of-tree-is-a-non-goal',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: '.agents/notes/archived/simplification/2026-08-11-remove-sdk-project-toolchain.zh.md',
    note: '官方主动移除 SDK 项目工具链：仓外工程化是官方非目标（本项目的存在理由）',
  },
  {
    id: 'author-docs-tree',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'docs/user/develop/basic/tool.zh.md',
    note: 'ctx.tools.register(defineTool(...)) 的最小可用写法',
  },
  {
    id: 'config-authoring-doc',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'docs/user/develop/basic/config.zh.md',
    note: 'Config schema 的默认值/必填与校验失败行为',
  },
  {
    id: 'events-authoring-doc',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'docs/user/develop/framework/events.zh.md',
    note: '事件 mode（emit/bail/serial/waterfall）与 waterfall 必须 next()',
  },
  {
    id: 'plugin-export-forms',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/AGENTS.md',
    note: 'function plugin 具名导出 name/inject/Config/apply，不可与 default 混用；可选服务用 ctx.get',
  },
  {
    id: 'default-export-postmortem',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'vendor/cordis/src/fiber.ts',
    line: 28,
    note: 'ValidationError 文本 `invalid config:\\n  - <message> (at <path>)`；校验同步执行',
  },
  {
    id: 'plugin-shape-error',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'vendor/cordis/src/registry.ts',
    line: 319,
    note: '非法插件形态抛 `invalid plugin, expect function or object with an "apply" method`',
  },
  {
    id: 'tool-register-contract',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/core/tools/src/index.ts',
    line: 1063,
    note: 'ctx.tools.register 返回 disposer；output{schema,render} 必填；run_code 名字保留',
  },
  {
    id: 'define-tool-helper',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/core/tools/src/schema.ts',
    line: 554,
    note: 'defineTool 从 parameters 推导并校验 args，生成 JSON Schema',
  },
  {
    id: 'agent-created-event',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/core/agent/src/runtime-types.ts',
    line: 261,
    note: "会话开始是 'agent/created'（带 source）；本快照没有 agent/session-start 事件",
  },
  {
    id: 'session-start-source',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    id: 'ui-slots-registration-conflicts',
    source: 'deepseek-harness@dsh-v0.2.0-rc.2',
    path: 'packages/client/ui-slots/src/index.ts',
    note: 'slot 注册冲突：一个 declarer、同 id 同 priority 二次注册抛错（already declared / already has a definition）',
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
