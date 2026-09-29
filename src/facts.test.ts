import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Fact ledger for the dsh facts hardened into `skill/SKILL.md`.
 *
 * Why this file exists: the skill states upstream facts (paths, pins, schema
 * shapes) that go stale the moment dsh changes. The ledger records each fact
 * once, with the reference checkout it came from, so a stale pointer is
 * reported as one concrete entry instead of surfacing as wrong guidance to a
 * user months later.
 *
 * The ledger is *versioned metadata*: the pin (`deepseek-harness@dsh-v0.1.7-rc.2`)
 * is meaningful even where the checkout is absent, and the metadata assertions
 * below always run. Re-verification is best-effort: the `3rdp/` reference tree
 * is a local, gitignored development convenience that does not ship, does not
 * exist in test/production (user installs), and whose absence must never break
 * the build, install, or test suite.
 *
 * Both halves of the skill ↔ ledger contract are enforced here:
 *
 * - Every upstream path cited by `skill/` must be a fact in this ledger.
 * - Every fact must name a known reference and a versioned revision.
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
const CITED_PATH_SHAPE = /(?:packages|apps|docs|\.agents|vendor)\/[A-Za-z0-9._/-]+/g;

/** Files under `skill/references/` named by `SKILL.md`. */
const REFERENCE_LINK_SHAPE = /references\/[A-Za-z0-9._-]+\.md/g;

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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 69,
    note: 'DshBundleManifest 唯一必填字段 patch: string | string[]',
  },
  {
    id: 'engines-declarative',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/util/package-manifest/src/types.ts',
    line: 22,
    note: 'engines 是声明式字段，当前无 reader 执行',
  },
  {
    id: 'bundle-patch-files',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 58,
    note: 'bundlePatchFiles：patch 必须是字符串或字符串数组（否则抛错）',
  },
  {
    id: 'profile-user-layer-last',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/app-boot/src/profile.ts',
    line: 684,
    note: 'profile 自身的 cordis.patch.yml 在全部 bundle 层之后作为最后一层',
  },
  {
    id: 'overlay-read-failure',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/app-boot/src/index.ts',
    line: 340,
    note: '被引用的 patch 文件读不到时抛 `failed to read overlay`（启动失败，不是警告）',
  },
  {
    id: 'entry-patch-semantics',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'vendor/include/src/index.ts',
    line: 57,
    note: 'applyEntryPatches：insert 追加、裸条目按 id 覆盖且整体替换 config、命中失败只 warn',
  },
  {
    id: 'same-id-entry-reuse',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'vendor/loader/src/config/group.ts',
    line: 20,
    note: 'EntryGroup.create 同 id 复用同一 entry（last-wins），0.1.7-rc.2 无 duplicate id 抛错',
  },
  {
    id: 'entry-id-generation',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
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
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/plugin-manager/src/operations.ts',
    line: 102,
    note: '无 dsh.bundle 的依赖只作普通依赖并打印警告，不成为 profile 层',
  },
  {
    id: 'bundle-reconcile-new-deps',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/plugin-manager/src/operations.ts',
    line: 255,
    note:
      'profile 依赖 reconcile：只对 profile 里首次出现的依赖追加 bundles 并加载 patch ' +
      '⟹ 安装失败（如 ERR_PNPM_IGNORED_BUILDS）不写 bundles，重跑 add 也不会补，须 remove 后重装',
  },
  {
    id: 'build-approval-retries-install',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/plugin-manager/src/index.ts',
    line: 474,
    note: 'installBundle 在装包前先 approveBuilds 写 allowBuilds=true 并重跑安装脚本',
  },
  {
    id: 'pnpm-build-blocked',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/plugin-manager/src/install-failure.ts',
    line: 22,
    note: 'ERR_PNPM_IGNORED_BUILDS / Ignored build scripts 归类为 build-blocked',
  },
  {
    id: 'allow-builds-placeholder',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/plugin-manager/src/build-approval.ts',
    line: 27,
    note: "pnpm 在 allowBuilds 留占位字面量 'set this to true or false' 表示待授权",
  },
  {
    id: 'git-hosted-prepare-hint',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'apps/cli/src/plugin.ts',
    line: 82,
    note: 'git 安装需作者 prepare + 用户 allowBuilds；dsh 打印修法',
  },
  {
    id: 'plugin-cli-forwards-pnpm',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'apps/cli/src/args.ts',
    line: 191,
    note: 'dsh plugin 把参数原样转发给 pnpm（add/remove/why/list…）',
  },
  {
    id: 'cli-reference',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'apps/cli/reference/README.zh.md',
    note: 'profile CLI 与层序的权威叙述',
  },
  {
    id: 'peer-compatibility-gate',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/app-boot/src/plugin-compatibility.ts',
    line: 98,
    note: '只对 @deepseek-ai/dsh / @deepseek-ai/dsh-* 的 peerDependencies 做兼容门禁并给豁免路径',
  },
  {
    id: 'package-meta-resolution',
    source: 'deepseek-harness@dsh-v0.1.7-rc.2',
    path: 'packages/boot/app-boot/src/package-meta.ts',
    line: 61,
    note: '元数据经 Node ESM resolver 解析；缺失资源（含 exports 未暴露）静默降级',
  },
];

/** A fact that cannot be re-verified because its reference tree is missing. */
interface PendingFact {
  id: string;
  source: string;
  path: string;
}

/**
 * Split the ledger by whether its reference checkout exists under
 * `referenceRoot`. Re-verification is only possible for the available half;
 * the pending half is the expected, unremarkable state everywhere but a local
 * development checkout.
 */
function referenceCandidates(referenceRoot: string = R3P_DIR): {
  available: Fact[];
  pending: PendingFact[];
} {
  const available: Fact[] = [];
  const pending: PendingFact[] = [];
  for (const fact of facts) {
    const reference = REFERENCES[repoOf(fact.source)];
    const exists = reference !== undefined && existsSync(join(referenceRoot, reference.dir));
    (exists ? available : pending).push(fact);
  }
  return { available, pending };
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

/** Every markdown file under `skill/`, as paths relative to `skill/`. */
function skillMarkdown(): string[] {
  return readdirSync(SKILL_DIR, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.md'))
    .sort();
}

/** Every upstream path cited anywhere under `skill/`. */
function citedPaths(): string[] {
  const cited = new Set<string>();
  for (const relative of skillMarkdown()) {
    const text = readFileSync(join(SKILL_DIR, relative), 'utf8');
    for (const match of text.matchAll(CITED_PATH_SHAPE)) {
      cited.add(match[0].replace(/:\d+(?:-\d+)?$/, '').replace(/\/$/, ''));
    }
  }
  return [...cited].sort();
}

/** Reference files the SKILL.md index names. */
function referencedFiles(): string[] {
  const text = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  return [...new Set(text.match(REFERENCE_LINK_SHAPE) ?? [])].sort();
}

/** Reference files that actually exist under `skill/references/`. */
function referenceFiles(): string[] {
  const dir = join(SKILL_DIR, 'references');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `references/${entry}`)
    .sort();
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

  it('keeps the reference index and the reference files in step', () => {
    // A reference that exists but is not indexed is unreachable; one that is
    // indexed but missing is a dead link. Both fail here rather than at read time.
    expect(referencedFiles()).toEqual(referenceFiles());
  });
});

describe('fact ledger re-verification', () => {
  // Computed once: whether the vendored checkout is here is a property of the
  // machine, not of test order.
  const local = referenceCandidates();

  it('finds nothing to re-verify when the reference tree is absent (the normal case)', () => {
    const { available, pending } = referenceCandidates(join(ROOT, 'no-such-reference-tree'));
    expect(available).toEqual([]);
    expect(pending.map((fact) => fact.id).sort()).toEqual(facts.map((fact) => fact.id).sort());
  });

  it('agrees with the vendored reference when it is present', () => {
    // Local development only: without 3rdp/ there is nothing to re-check, and
    // that is the normal case in test/production. No warning is emitted — a
    // missing checkout is expected, not a problem to report.
    if (local.available.length === 0) {
      return;
    }

    const failures: string[] = [];

    for (const source of new Set(local.available.map((fact) => fact.source))) {
      const reference = REFERENCES[repoOf(source)];
      if (reference === undefined) continue;
      const packageJsonPath = join(R3P_DIR, reference.dir, reference.packageJson);
      expect(existsSync(packageJsonPath), `${source}: missing ${packageJsonPath}`).toBe(true);
      const declared = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string })
        .version;
      const expected = versionFromTag(source);
      if (declared !== expected) {
        failures.push(
          `${source}: checkout declares version "${declared}", ledger pins "${expected}"`
        );
      }
    }

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

  it('actually re-verified the checkout when it is present', () => {
    // Guards against the verification silently becoming a no-op on a machine
    // that does have 3rdp/ — absent here means "nothing to check", not "pass".
    if (local.available.length === 0) {
      return;
    }
    expect(local.available.length).toBeGreaterThan(0);
  });
});
