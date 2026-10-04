// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeCard,
  containsElement,
  defaultAction,
  isActiveCard,
  kindOf,
  options,
} from './dom.ts';
import type { CardInfo } from './dom.ts';
import { cardMarkup, mount, rawDocument, wrapDocument, wrapElement } from './test-support.ts';
/** One entry of a list the fixture guarantees to be present. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`fixture has no element at ${String(index)}`);
  return value;
}

/** The one active card in the current fixture, or a spec failure. */
function requireCard(): CardInfo {
  const card = activeCard(wrapDocument(rawDocument));
  if (card === undefined) throw new Error('fixture has no active card');
  return card;
}

beforeEach(() => {
  mount('');
});

describe('keyboard dom judgement', () => {
  it('recognizes each card flavour by its own attribute', () => {
    mount(cardMarkup('approval'));
    const approvalCard = at(wrapDocument(rawDocument).querySelectorAll('[data-approval-key]'), 0);
    expect(kindOf(approvalCard)).toBe('approval');
    expect(kindOf(wrapElement(rawDocument.body))).toBeUndefined();
  });

  it.each(['approval', 'plan-review', 'question'] as const)(
    'resolves the %s card with its answer surface',
    (kind) => {
      mount(cardMarkup(kind));
      const card = activeCard(wrapDocument(rawDocument));
      expect(card?.kind).toBe(kind);
      expect(card?.surface).not.toBe(card?.card);
    }
  );

  it('takes the last card in document order when several are pending', () => {
    mount(cardMarkup('approval') + cardMarkup('question'));
    const card = activeCard(wrapDocument(rawDocument));
    expect(card?.kind).toBe('question');
    expect(card?.card.matches('[data-question-key]')).toBe(true);
  });

  it('leaves a read-only transcript review card alone', () => {
    mount(`<div data-question-reply="call-9"><div data-question-key="q-9"></div></div>`);
    expect(activeCard(wrapDocument(rawDocument))).toBeUndefined();
  });

  it('leaves a busy and an inert card alone', () => {
    mount(`<div data-approval-key="a1" aria-busy="true"></div>`);
    expect(activeCard(wrapDocument(rawDocument))).toBeUndefined();
    mount(`<div inert><div data-approval-key="a2"></div></div>`);
    expect(activeCard(wrapDocument(rawDocument))).toBeUndefined();
  });

  it('is active when no overlay or submission is in flight', () => {
    mount(cardMarkup('approval'));
    expect(isActiveCard(requireCard().card)).toBe(true);
  });

  it('prefers the primary action over the last button', () => {
    mount(cardMarkup('plan-review'));
    const primary = defaultAction(requireCard().card);
    expect(primary?.className).toContain('_primary_');
  });

  it('falls back to the last enabled button of the action row', () => {
    mount(`<div data-approval-key="a1">
      <div class="_actionRow_1">
        <button disabled>拒绝</button>
        <button>允许一次</button>
      </div>
    </div>`);
    const action = defaultAction(requireCard().card);
    expect(action?.disabled).toBe(false);
  });

  it('has no default action when the card offers no usable button', () => {
    mount(
      `<div data-approval-key="a1"><div class="_actionRow_1"><button disabled>拒绝</button></div></div>`
    );
    expect(defaultAction(requireCard().card)).toBeUndefined();
  });

  it('navigates declared options and skips disabled ones', () => {
    mount(cardMarkup('question'));
    const list = options(requireCard().card);
    expect(list).toHaveLength(2);
    expect(list[0]?.disabled).toBe(false);
  });

  it('treats the approval action row as the navigable options', () => {
    mount(cardMarkup('approval'));
    expect(
      options(requireCard().card).map((button) => button.className?.includes('_primary_') === true)
    ).toEqual([false, true]);
  });

  it('detects containment through the parent chain, not the card itself only', () => {
    mount(cardMarkup('approval'));
    const buttons = options(requireCard().card);
    expect(containsElement(requireCard().card, at(buttons, 0))).toBe(true);
    expect(containsElement(requireCard().card, wrapElement(rawDocument.body))).toBe(false);
    expect(containsElement(requireCard().card, null)).toBe(false);
  });
});
