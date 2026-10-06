/**
 * The bilingual README pair.
 *
 * `README.md` (English) and `README.zh.md` (Chinese) are one document in two
 * languages: the same sections in the same order, each opening with a link to
 * the other. That duplication is deliberate — npm and GitHub show the English
 * one, a Chinese reader gets the other — so the sync rule is machine-checked
 * here instead of living only in `AGENTS.md`.
 *
 * `CONTRIBUTING.md` is intentionally single-language (English) and is not
 * checked.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function read(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

/** Heading levels (`##` → 2) in document order, ignoring fenced code blocks. */
function headingLevels(markdown: string): number[] {
  const levels: number[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const hashes = /^(#{1,6})\s+\S/.exec(line)?.[1];
    if (hashes) levels.push(hashes.length);
  }
  return levels;
}

/** Badge lines: identical in both languages, so drift there is real drift. */
function badgeLines(markdown: string): string[] {
  return markdown.split('\n').filter((line) => line.startsWith('[!['));
}

const en = read('README.md');
const zh = read('README.zh.md');

describe('bilingual README pair', () => {
  it('cross-links the two languages', () => {
    expect(en).toContain('[中文](README.zh.md)');
    expect(zh).toContain('[English](README.md)');
  });

  it('shares the title and the badge block', () => {
    expect(en.startsWith('# dsh-dev-dsh\n')).toBe(true);
    expect(zh.startsWith('# dsh-dev-dsh\n')).toBe(true);
    expect(badgeLines(en).length).toBeGreaterThan(0);
    expect(badgeLines(zh)).toEqual(badgeLines(en));
  });

  it('has the same section structure in both languages', () => {
    expect(headingLevels(zh)).toEqual(headingLevels(en));
  });
});
