/**
 * Pure DOM judgement for the `keyboard` submodule: which takeover card is
 * active, what its default action is, and which options it offers.
 *
 * Everything here is a read-only function over the injected document, so the
 * whole decision surface is unit-testable without a live React tree. The DOM
 * facts come from the shipped client packages (`ui-approval`, `ui-user-questions`)
 * and are pinned by the `data-*` attributes those components own:
 * `[data-approval-key]`, `[data-plan-review-key]`, `[data-question-key]`,
 * `[data-approval-scroll]`, `[data-question-scroll]`.
 */

import type { DocumentLike, ElementLike } from './types.js';

/** Every card that takes over the composer and blocks on a human answer. */
const CARD_SELECTOR = '[data-approval-key], [data-plan-review-key], [data-question-key]';

/** The read-only transcript review card: never a live request. */
const REPLY_CARD_SELECTOR = '[data-question-reply]';

/** Cards that never accept input on the browser's behalf. */
const INERT_SELECTOR = '[inert], [aria-disabled="true"]';

/** Anything that owns the caret: the keyboard half must not steal focus. */
export const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** The scrollable answer region of every card flavour. */
const SURFACE_SELECTOR = '[data-approval-scroll], [data-question-scroll]';

/**
 * Candidate markers for the card's primary action, tried in order.
 *
 * Preferred marker first: `ui-primitives` renders `Button variant="primary"` with
 * its CSS-Modules class (`_primary_<hash>`), which both the approval card
 * ("allow once") and the plan-review card ("Approve") use. The action-row
 * containers are the fallback when a future build renames the hash.
 */
const PRIMARY_BUTTON_SELECTOR = 'button[class*="_primary_"]';
const ACTION_ROW_SELECTOR =
  '[class*="_actionRow_"], [class*="_actions_"], [class*="_footerActions_"]';
const BUTTON_SELECTOR = 'button';
const OPTION_SELECTOR = 'button[role="radio"], button[role="checkbox"]';

/** A card flavour, keyed by the attribute the owning component renders. */
export type CardKind = 'approval' | 'plan-review' | 'question';

/** One active card resolved from the document. */
export interface CardInfo {
  kind: CardKind;
  /** The card root, used for containment checks and action lookup. */
  card: ElementLike;
  /** The scrollable answer region, or the card itself when none is present. */
  surface: ElementLike;
}

/**
 * The flavour attribute of a candidate card.
 *
 * @param element - a candidate card root.
 * @returns the card kind, or `undefined` when the element is not a card.
 */
export function kindOf(element: ElementLike): CardKind | undefined {
  if (element.matches('[data-approval-key]')) return 'approval';
  if (element.matches('[data-plan-review-key]')) return 'plan-review';
  if (element.matches('[data-question-key]')) return 'question';
  return undefined;
}

/**
 * Whether a card is waiting for a human answer right now.
 *
 * A transcript review card has no answer channel, a busy card is already
 * submitting, and an inert card sits behind an overlay — all three must be left
 * alone so the keyboard half cannot double-submit or answer something stale.
 *
 * @param card - a candidate card root.
 * @returns `true` when the card accepts input.
 */
export function isActiveCard(card: ElementLike): boolean {
  if (card.closest(REPLY_CARD_SELECTOR) !== null) return false;
  if (card.closest(INERT_SELECTOR) !== null) return false;
  if (card.matches('[aria-busy="true"]') || card.closest('[aria-busy="true"]') !== null)
    return false;
  return true;
}

/**
 * Resolve the card the composer is currently occupied by.
 *
 * The last match in document order wins: when a session has more than one
 * pending request, the takeover slot renders the top-most card last.
 *
 * @param document - the live document.
 * @returns the active card, or `undefined` when the composer is not taken over.
 */
export function activeCard(document: DocumentLike): CardInfo | undefined {
  const candidates = [...document.querySelectorAll(CARD_SELECTOR)];
  let found: CardInfo | undefined;
  for (const card of candidates) {
    const kind = kindOf(card);
    if (kind === undefined) continue;
    if (!isActiveCard(card)) continue;
    const surface = card.querySelectorAll(SURFACE_SELECTOR)[0] ?? card;
    found = { kind, card, surface };
  }
  return found;
}

/** Every enabled `button` under `root`, in DOM order. */
function enabledButtons(root: ElementLike): ElementLike[] {
  return [...root.querySelectorAll(BUTTON_SELECTOR)].filter((button) => button.disabled !== true);
}

/**
 * The card's default action: what Enter must trigger.
 *
 * @param card - an active card root.
 * @returns the primary button, else the last enabled button of the card's action
 *   row, else `undefined` — an unresolvable default must never be guessed.
 */
export function defaultAction(card: ElementLike): ElementLike | undefined {
  const primary = enabledButtons(card).find((button) => button.matches(PRIMARY_BUTTON_SELECTOR));
  if (primary !== undefined) return primary;
  for (const row of card.querySelectorAll(ACTION_ROW_SELECTOR)) {
    const last = enabledButtons(row).at(-1);
    if (last !== undefined) return last;
  }
  return undefined;
}

/**
 * The selectable options of a card, in DOM order.
 *
 * Question and plan-review cards render one `button[role]` per option; the
 * approval card has no options, so its action row stands in for them (that is
 * what makes ↑/↓ move between "reject" and "allow once").
 *
 * @param card - an active card root.
 * @returns the navigable buttons.
 */
export function options(card: ElementLike): ElementLike[] {
  const declared = enabledButtons(card).filter((button) => button.matches(OPTION_SELECTOR));
  if (declared.length > 0) return declared;
  for (const row of card.querySelectorAll(ACTION_ROW_SELECTOR)) {
    const buttons = enabledButtons(row);
    if (buttons.length > 0) return buttons;
  }
  return enabledButtons(card);
}

/**
 * Whether `element` is inside `card` (or is the card itself).
 *
 * Walking `parentNode` needs no attribute escaping for keys that contain
 * punctuation, so the check stays correct for any `data-*-key` value.
 *
 * @param card - the card root.
 * @param element - the element to test, usually `document.activeElement`.
 * @returns `true` when the element belongs to the card subtree.
 */
export function containsElement(card: ElementLike, element: ElementLike | null): boolean {
  let node: ElementLike | null | undefined = element;
  while (node !== undefined && node !== null) {
    if (node === card) return true;
    node = node.parentNode;
  }
  return false;
}
