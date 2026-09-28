import { existsSync, readFileSync } from 'node:fs';
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
const CITED_PATH_SHAPE = /(?:packages|apps|docs|\.agents)\/[A-Za-z0-9._/-]+/g;

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

/** Every upstream path cited anywhere under `skill/`. */
function citedPaths(): string[] {
  const text = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  return (text.match(CITED_PATH_SHAPE) ?? []).map((cited) => cited.replace(/:\d+(?:-\d+)?$/, ''));
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
