/**
 * The `keyboard` submodule's browser half: fill the focus gap the composer
 * takeover cards leave behind.
 *
 * Every prompt card (`ui-approval`, `ui-user-questions`) replaces the composer
 * without taking focus, and each one binds its keyboard behaviour to elements
 * that must already be focused — the approval card gates its own `onKeyDown` on
 * `currentTarget.contains(document.activeElement)`, and the plan-review and
 * question cards only listen on their buttons. With focus on `document.body`
 * Enter therefore does nothing at all. This module observes the *already
 * arbitrated* fixed input (so the command palette, modals, editable regions and
 * terminals all keep priority) and only acts where the native handlers cannot
 * see the key: it focuses the card's default action and clicks it on Enter,
 * moves focus between options on ↑/↓, and focuses the card when it first appears.
 *
 * It never consumes the gesture: the situation it covers is exactly the one in
 * which nothing else claims the key, and staying out of the arbitration keeps
 * upstream behaviour authoritative wherever it exists.
 *
 * The whole half is inert unless the mount line sets `keyboard.enabled: true` —
 * see `src/keyboard/host.ts` for why the switch is compiled into the bundle.
 */

import { activeCard, containsElement, defaultAction, options } from './dom.js';
import type { CardInfo } from './dom.js';
import type { KeyboardConfig } from './config.js';
import type {
  ClientContextLike,
  DocumentLike,
  ElementLike,
  ShortcutFixedInputLike,
  ShortcutsLike,
  WindowLike,
} from './types.js';

/** The reference row this submodule contributes to the shortcut catalog. */
export const KEYBOARD_COMMAND_ID = 'approval.allow';

/** The one-line label of the contributed reference row. */
const KEYBOARD_COMMAND_LABEL = '提示卡确认（Enter）';

/** The injected browser surface, kept explicit so the submodule is testable. */
export interface KeyboardEnvironment {
  window: WindowLike;
  document: DocumentLike;
  /** `document.hasFocus()`, read fresh on every decision. */
  hasFocus: () => boolean;
  /** The mutation-observer constructor, read off the live window. */
  mutationObserver?: unknown;
}

/** Outcome of one installation attempt (observable in tests). */
export interface KeyboardClientOutcome {
  ok: boolean;
  reason?: string | undefined;
}

/** Guards the gesture must satisfy before this module looks at the document. */
function allowed(input: Extract<ShortcutFixedInputLike, { type: 'keydown' }>): boolean {
  const { gesture, context } = input;
  if (gesture.defaultPrevented) return false;
  if (gesture.composing || gesture.repeat) return false;
  if (gesture.control || gesture.alt || gesture.meta) return false;
  if (gesture.shift && gesture.code !== 'Enter') return false;
  if (context.modal !== null) return false;
  if (context.region !== 'page') return false;
  return true;
}

/** The element that currently owns the keyboard, from the injected document. */
function activeElementOf(env: KeyboardEnvironment): ElementLike | null {
  return env.document.activeElement;
}

/** Move focus onto the card's default action, or its first option. */
function focusDefault(card: CardInfo, env: KeyboardEnvironment): void {
  const target = defaultAction(card.card) ?? options(card.card)[0];
  if (target === undefined) return;
  if (activeElementOf(env) === target) return;
  target.focus();
}

/** Move focus one option up or down, wrapping at both ends. */
function moveOption(card: CardInfo, direction: 1 | -1, env: KeyboardEnvironment): void {
  const list = options(card.card);
  if (list.length === 0) return;
  const active = activeElementOf(env);
  const index = active === null ? -1 : list.indexOf(active);
  if (index === -1) {
    // Focus is outside the card (or on the card itself): enter the list at the end
    // that matches the direction so the first press does not skip an entry.
    const first = direction === 1 ? list[0] : list[list.length - 1];
    first?.focus();
    return;
  }
  const next = list[(index + direction + list.length) % list.length];
  next?.focus();
}

/**
 * Handle one arbitrated fixed input.
 *
 * @param input - a delivered gesture or a sequence-resetting interaction.
 * @param env - injected browser surface.
 */
export function handleFixedInput(input: ShortcutFixedInputLike, env: KeyboardEnvironment): void {
  if (input.type !== 'keydown') return;
  if (!allowed(input)) return;
  const card = activeCard(env.document);
  if (card === undefined) return;
  const inside = containsElement(card.card, activeElementOf(env));
  if (input.gesture.code === 'Enter') {
    if (inside) return; // The card's own handlers own this key.
    const target = defaultAction(card.card);
    if (target === undefined) return;
    target.focus();
    target.click();
    return;
  }
  if (input.gesture.code === 'ArrowDown') moveOption(card, 1, env);
  else if (input.gesture.code === 'ArrowUp') moveOption(card, -1, env);
}

/** Whether an ancestor of `element` owns the caret. */
function insideEditable(element: ElementLike): boolean {
  for (
    let node: ElementLike | null | undefined = element;
    node !== undefined && node !== null;
    node = node.parentNode
  ) {
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    const editable = node.contentEditable;
    if (editable === 'true' || editable === '' || editable === 'plaintext-only') return true;
    const attribute =
      typeof node.getAttribute === 'function' ? node.getAttribute('contenteditable') : null;
    if (attribute === 'true' || attribute === '' || attribute === 'plaintext-only') return true;
  }
  return false;
}

/**
 * The focus policy for a newly rendered card.
 *
 * Focus moves only when the card appears while the keyboard is somewhere
 * neutral — the page body, or nothing at all. A caret in a field, a modal, a
 * hidden card or a window the user has left all keep their own focus, which is
 * what stops the card from stealing a draft or a selection.
 *
 * @param active - the element that owns the keyboard, when the document has one.
 * @param hasFocus - whether the document owns the window's focus.
 * @param hasModal - whether a modal layer sits above the card.
 * @param visible - whether the card reports a layout box.
 * @returns whether the card may take focus.
 */
export function shouldFocusOnAppear(
  active: ElementLike | null,
  hasFocus: boolean,
  hasModal: boolean,
  visible: boolean
): boolean {
  if (!hasFocus || !visible || hasModal) return false;
  if (active === null) return true;
  const tag = active.tagName;
  if (tag === 'BODY' || tag === 'HTML' || tag === undefined) return true;
  return !insideEditable(active);
}

/**
 * Take focus once per card appearance.
 *
 * Focus moves only when the card appears while the keyboard is elsewhere — a
 * caret in a field, a modal, a hidden card, or a window the user has left all
 * keep their own focus. Because the card is remembered until it disappears, a
 * user who deliberately clicks away is never dragged back by a later mutation.
 *
 * @param env - injected browser surface.
 * @returns an idempotent disposer releasing the observer.
 */
export function observeCardAppearance(env: KeyboardEnvironment): () => void {
  const observerCtor = asObserverCtor(env.mutationObserver);
  if (observerCtor === undefined) return () => {};
  const root = env.document.body ?? env.document;
  let current: ElementLike | undefined;
  const inspect = (): void => {
    const card = activeCard(env.document);
    if (card === undefined) {
      current = undefined;
      return;
    }
    if (current === card.card) return;
    current = card.card;
    const modal = env.document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 0;
    if (
      !shouldFocusOnAppear(
        activeElementOf(env),
        env.hasFocus(),
        modal,
        card.card.getClientRects().length > 0
      )
    ) {
      return;
    }
    focusDefault(card, env);
  };
  const observer = new observerCtor(inspect);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}

/**
 * Stay inert when the feature is off, and never throw when it is on.
 *
 * The client entry's `apply` failing rejects the whole page boot, so a missing
 * or malformed service is reported as a warning and the rest of the application
 * stays untouched.
 *
 * @param ctx - plugin-owned client context.
 * @param config - the mount-line config; `enabled: false` wires nothing at all.
 * @returns the installation outcome; it never throws.
 */
export function installKeyboardClient(
  ctx: ClientContextLike,
  config: KeyboardConfig
): KeyboardClientOutcome {
  if (config.enabled !== true) return { ok: true, reason: 'disabled' };
  try {
    ctx.inject(['shortcuts'], (scope) => {
      installKeyboardInScope(scope);
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/** Wire the observer and the reference row against an injected scope. */
function installKeyboardInScope(scope: ClientContextLike): void {
  const shortcuts = asShortcuts(scope.get('shortcuts'));
  const windowLike = asWindow(scope.get('window'));
  if (shortcuts === undefined || windowLike === undefined) {
    warn('window or shortcuts service is unavailable; prompt-card keys stay unwired');
    return;
  }
  const env: KeyboardEnvironment = {
    window: windowLike,
    document: windowLike.document,
    hasFocus: () => windowLike.document.hasFocus(),
    ...(typeof windowLike.MutationObserver === 'function'
      ? { mutationObserver: windowLike.MutationObserver }
      : {}),
  };
  try {
    scope.effect(() => {
      const off = shortcuts.observeFixedInput((input) => {
        handleFixedInput(input, env);
      });
      const observe = observeCardAppearance(env);
      return () => {
        off();
        observe();
      };
    }, 'dsh-dev-dsh: prompt-card keys');
    registerReferenceRow(shortcuts);
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
  }
}

/** Contribute a read-only reference row; an id already in use is not an error. */
function registerReferenceRow(shortcuts: ShortcutsLike): void {
  try {
    shortcuts.registerFixed({
      id: KEYBOARD_COMMAND_ID,
      label: () => KEYBOARD_COMMAND_LABEL,
      keys: ['Enter'],
      bindings: [{ code: 'Enter', modifiers: [] }],
      group: 'approval',
    });
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
  }
}

/** Report a degradation on the console without breaking the boot. */
function warn(message: string): void {
  // eslint-disable-next-line no-console -- the browser half has no host logger.
  console.warn(`[dsh-dev-dsh/keyboard] ${message}`);
}

/** Narrow an unknown value to a mutation-observer constructor. */
function asObserverCtor(value: unknown):
  | (new (callback: () => void) => {
      observe(root: unknown, options: object): void;
      disconnect(): void;
    })
  | undefined {
  return typeof value === 'function'
    ? (value as new (callback: () => void) => {
        observe(root: unknown, options: object): void;
        disconnect(): void;
      })
    : undefined;
}

/** Narrow an unknown value to the `ctx.shortcuts` slice this submodule uses. */
function asShortcuts(value: unknown): ShortcutsLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.observeFixedInput !== 'function') return undefined;
  if (typeof record.registerFixed !== 'function') return undefined;
  return value as ShortcutsLike;
}

/** Narrow an unknown value to the window slice this submodule uses. */
function asWindow(value: unknown): WindowLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const document = (value as { document?: unknown }).document;
  if (typeof document !== 'object' || document === null) return undefined;
  const record = document as Record<string, unknown>;
  if (typeof record.querySelectorAll !== 'function') return undefined;
  if (typeof record.hasFocus !== 'function') return undefined;
  return value as WindowLike;
}
