// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleFixedInput,
  installKeyboardClient,
  observeCardAppearance,
  shouldFocusOnAppear,
} from './client.ts';
import type { KeyboardEnvironment } from './client.ts';
import {
  cardMarkup,
  mount,
  rawDocument,
  rawWindow,
  wrapDocument,
  wrapElement,
  wrapWindow,
} from './test-support.ts';
import type { ElementLike } from './types.ts';
import type { ClientContextLike, ShortcutFixedInputLike, ShortcutsLike } from './types.ts';

const enabled = { enabled: true };
const disabled = { enabled: false };

/** A gesture as the shortcut adapter arbitrates it before delivery. */
function gesture(code: string, overrides: Record<string, unknown> = {}) {
  return {
    code,
    alt: false,
    control: false,
    shift: false,
    meta: false,
    repeat: false,
    composing: false,
    defaultPrevented: false,
    ...overrides,
  };
}

/** One delivered keydown with the default page region and no modal layer. */
function keydown(
  code: string,
  context: { modal?: string | null; region?: 'page' | 'editable' | 'terminal' } = {},
  gestureOverrides: Record<string, unknown> = {}
): ShortcutFixedInputLike {
  return {
    type: 'keydown',
    gesture: gesture(code, gestureOverrides),
    context: { modal: context.modal ?? null, region: context.region ?? 'page' },
    consume: () => {},
  };
}

/** The injected environment over the ambient jsdom document. */
function environment(): KeyboardEnvironment {
  const win = wrapWindow(rawWindow);
  return {
    window: win,
    document: wrapDocument(rawDocument),
    hasFocus: () => true,
    ...(win.MutationObserver === undefined ? {} : { mutationObserver: win.MutationObserver }),
  };
}

/** A client context whose injected scope exposes the given services. */
function fakeScope(values: Record<string, unknown> = {}): ClientContextLike {
  const scope: ClientContextLike = {
    get: (name) => values[name],
    inject: () => undefined,
    effect: () => undefined,
  };
  return {
    ...scope,
    inject: (_services, callback) => {
      callback(scope);
      return undefined;
    },
  };
}

/** A context whose `inject` activates its scope immediately, as cordis does. */
function activatingContext(values: Record<string, unknown>): {
  ctx: ClientContextLike;
  effects: (() => () => void)[];
} {
  const effects: (() => () => void)[] = [];
  return {
    effects,
    ctx: {
      get: () => undefined,
      inject: (_services, callback) => {
        callback({
          get: (name) => values[name],
          inject: () => undefined,
          effect: (callback2) => {
            effects.push(callback2);
            return undefined;
          },
        });
        return undefined;
      },
      effect: (callback) => {
        effects.push(callback);
        return undefined;
      },
    },
  };
}

/** Collect console warnings raised by the browser half during one spec. */
function captureWarnings(): string[] {
  const warnings: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
  return warnings;
}

/**
 * jsdom gives every element no layout box, so the "card is actually visible"
 * gate never passes. These stand in for the box a browser reports.
 */
const VISIBLE_BOX = {
  0: { x: 0, y: 0, width: 320, height: 120 },
  length: 1,
  item: () => null,
  [Symbol.iterator]: function* () {
    yield { x: 0, y: 0, width: 320, height: 120 };
  },
} as unknown as DOMRectList;

const EMPTY_BOX = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as unknown as DOMRectList;

/** What `getClientRects` reports for the current spec. */
let boxes: DOMRectList = EMPTY_BOX;

/** Let jsdom deliver the mutations queued since the last microtask checkpoint. */
async function drain(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** The document's current keyboard owner, as the module sees it. */
function focused(): ElementLike | null {
  return wrapDocument(rawDocument).activeElement;
}

/** Every button the current fixture renders, in DOM order. */
function allButtons(selector = 'button'): ElementLike[] {
  return [...wrapDocument(rawDocument).querySelectorAll(selector)];
}

/** The primary button of the currently mounted card. */
function primary(): ElementLike {
  const found = allButtons('button[class*="_primary_"]')[0];
  if (found === undefined) throw new Error('fixture has no primary button');
  return found;
}

/** One entry of a list the fixture guarantees to be present. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`fixture has no element at ${String(index)}`);
  return value;
}

beforeEach(() => {
  document.body.innerHTML = '';
  boxes = EMPTY_BOX;
  // Invisible by default: only the appearance specs opt into a layout box.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => boxes);
});

afterEach(() => {
  boxes = EMPTY_BOX;
  vi.restoreAllMocks();
});

describe('prompt-card keyboard handling', () => {
  it('clicks the default action on Enter when focus is outside the card', () => {
    mount(cardMarkup('approval'));
    const clicked = vi.fn();
    primary().addEventListener('click', clicked);
    handleFixedInput(keydown('Enter'), environment());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('approves the plan-review card on Enter', () => {
    mount(cardMarkup('plan-review'));
    const clicked = vi.fn();
    primary().addEventListener('click', clicked);
    handleFixedInput(keydown('Enter'), environment());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way when focus is already inside the card', () => {
    mount(cardMarkup('approval'));
    const clicked = vi.fn();
    primary().addEventListener('click', clicked);
    primary().focus();
    handleFixedInput(keydown('Enter'), environment());
    expect(clicked).not.toHaveBeenCalled();
  });

  it('wraps focus across the approval action row on ArrowDown and ArrowUp', () => {
    mount(cardMarkup('approval'));
    const buttons = allButtons();
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(buttons, 0).className);
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(buttons, 1).className);
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(buttons, 0).className);
    handleFixedInput(keydown('ArrowUp'), environment());
    expect(focused()?.className).toBe(at(buttons, 1).className);
  });

  it('skips disabled options when moving through a question card', () => {
    mount(cardMarkup('question'));
    const options = allButtons('button[role="radio"]');
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(options, 0).className);
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(options, 1).className);
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.className).toBe(at(options, 0).className);
  });

  it.each([
    ['a modal layer is open', () => keydown('Enter', { modal: 'settings' })],
    ['focus is in an editable region', () => keydown('Enter', { region: 'editable' })],
    ['focus is in the terminal', () => keydown('Enter', { region: 'terminal' })],
    ['a modifier is held', () => keydown('Enter', {}, { control: true })],
    ['the gesture is a repeat', () => keydown('Enter', {}, { repeat: true })],
    ['the gesture is composing', () => keydown('Enter', {}, { composing: true })],
    ['the event was already handled', () => keydown('Enter', {}, { defaultPrevented: true })],
    ['the key is not Enter or an arrow', () => keydown('Escape')],
  ])('does nothing when %s', (_name, make) => {
    mount(cardMarkup('approval'));
    const clicked = vi.fn();
    primary().addEventListener('click', clicked);
    handleFixedInput(make(), environment());
    expect(clicked).not.toHaveBeenCalled();
    expect(focused()?.tagName).toBe('BODY');
  });

  it('ignores every gesture while no card is mounted', () => {
    mount('<div></div>');
    handleFixedInput(keydown('Enter'), environment());
    handleFixedInput(keydown('ArrowDown'), environment());
    expect(focused()?.tagName).toBe('BODY');
  });

  it('ignores a sequence reset', () => {
    mount(cardMarkup('approval'));
    handleFixedInput({ type: 'reset' }, environment());
    expect(focused()?.tagName).toBe('BODY');
  });

  it('focuses the default action once when the card first appears', async () => {
    boxes = VISIBLE_BOX;
    const dispose = observeCardAppearance(environment());
    mount(cardMarkup('approval'));
    await drain();
    expect(focused()).toBe(primary());
    dispose();
    await drain();
  });

  it('does not take focus twice for the same card', async () => {
    boxes = VISIBLE_BOX;
    const dispose = observeCardAppearance(environment());
    mount(cardMarkup('approval'));
    await drain();
    expect(focused()).toBe(primary());
    const active = focused();
    if (active === null) throw new Error('fixture has no focused element');
    active.blur();
    document.body.append(document.createElement('div'));
    await drain();
    expect(focused()?.tagName).toBe('BODY');
    dispose();
    await drain();
  });

  it('stays inert when the injected surface has no mutation observer', async () => {
    const dispose = observeCardAppearance({ ...environment(), mutationObserver: undefined });
    boxes = VISIBLE_BOX;
    mount(cardMarkup('approval'));
    await drain();
    expect(focused()?.tagName).toBe('BODY');
    dispose();
  });
});

describe('card appearance focus policy', () => {
  it('never takes focus when the window or the card is not usable yet', () => {
    expect(shouldFocusOnAppear(null, false, false, true)).toBe(false);
    expect(shouldFocusOnAppear(null, true, false, false)).toBe(false);
    expect(shouldFocusOnAppear(null, true, true, true)).toBe(false);
  });

  it('takes focus from a neutral owner', () => {
    expect(shouldFocusOnAppear(null, true, false, true)).toBe(true);
    expect(shouldFocusOnAppear(wrapElement(rawDocument.body), true, false, true)).toBe(true);
  });

  it('leaves a caret alone and accepts any other owner', () => {
    mount('<textarea></textarea><input><div contenteditable="true"></div><span></span>');
    const [textarea, input, editable, span] = [
      ...document.querySelectorAll('textarea, input, div, span'),
    ];
    expect(shouldFocusOnAppear(wrapElement(textarea), true, false, true)).toBe(false);
    expect(shouldFocusOnAppear(wrapElement(input), true, false, true)).toBe(false);
    expect(shouldFocusOnAppear(wrapElement(editable), true, false, true)).toBe(false);
    expect(shouldFocusOnAppear(wrapElement(span), true, false, true)).toBe(true);
  });
});

describe('browser-half installation', () => {
  it('wires nothing while the mount line leaves the submodule disabled', () => {
    const observed = vi.fn();
    const shortcuts: ShortcutsLike = { observeFixedInput: observed, registerFixed: () => () => {} };
    expect(installKeyboardClient(fakeScope({ shortcuts }), disabled)).toEqual({
      ok: true,
      reason: 'disabled',
    });
    expect(observed).not.toHaveBeenCalled();
  });

  it('observes fixed input and contributes its reference row once enabled', () => {
    const observed = vi.fn<(input: ShortcutFixedInputLike) => () => void>(() => () => {});
    const registerFixed = vi.fn(() => () => {});
    const { ctx, effects } = activatingContext({
      shortcuts: { observeFixedInput: observed, registerFixed },
      window: rawWindow,
    });
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: true });
    expect(effects).toHaveLength(1);
    expect(observed).not.toHaveBeenCalled(); // The effect owns the subscription.
    const dispose = at(effects, 0)();
    expect(observed).toHaveBeenCalledTimes(1);
    const listener = observed.mock.calls[0]?.[0] as unknown as (
      input: ShortcutFixedInputLike
    ) => void;
    expect(typeof listener).toBe('function');
    expect(typeof dispose).toBe('function');
    expect(registerFixed).toHaveBeenCalledTimes(1);
  });

  it('reads the page window from the global object when no service provides one', () => {
    const observed = vi.fn<(input: ShortcutFixedInputLike) => () => void>(() => () => {});
    const registerFixed = vi.fn(() => () => {});
    const { ctx, effects } = activatingContext({
      shortcuts: { observeFixedInput: observed, registerFixed },
    });
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: true });
    const dispose = at(effects, 0)();
    expect(observed).toHaveBeenCalledTimes(1);
    expect(typeof dispose).toBe('function');
  });

  it('warns and stays inert when the shortcuts service is not on the scope', () => {
    const warnings = captureWarnings();
    const { ctx, effects } = activatingContext({});
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: true });
    expect(effects).toEqual([]);
    expect(warnings.join('\n')).toContain('[dsh-dev-dsh/keyboard]');
  });

  it('reports a duplicate reference row without failing the installation', () => {
    const warnings = captureWarnings();
    const registerFixed = vi.fn(() => {
      throw new Error('Duplicate shortcut command: approval.allow');
    });
    const { ctx, effects } = activatingContext({
      shortcuts: { observeFixedInput: () => () => {}, registerFixed },
      window: rawWindow,
    });
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: true });
    at(effects, 0)();
    expect(registerFixed).toHaveBeenCalledTimes(1);
    expect(warnings.join('\n')).toContain('Duplicate shortcut command');
  });

  it('warns and stays inert when a service is not a usable window', () => {
    const warnings = captureWarnings();
    const registerFixed = vi.fn(() => () => {});
    const { ctx, effects } = activatingContext({
      shortcuts: { observeFixedInput: () => () => {}, registerFixed },
      window: 'not a window',
    });
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: true });
    expect(effects).toEqual([]);
    expect(registerFixed).not.toHaveBeenCalled();
    expect(warnings.join('\n')).toContain('[dsh-dev-dsh/keyboard]');
  });

  it('warns and stays inert when the scope was never reached', () => {
    const warnings = captureWarnings();
    expect(installKeyboardClient(fakeScope({}), enabled)).toEqual({ ok: true });
    expect(warnings.join('\n')).toContain('[dsh-dev-dsh/keyboard]');
  });

  it('never throws when the wiring itself fails', () => {
    const ctx: ClientContextLike = {
      get: () => undefined,
      inject: () => {
        throw new Error('inject refused');
      },
      effect: () => undefined,
    };
    expect(installKeyboardClient(ctx, enabled)).toEqual({ ok: false, reason: 'inject refused' });
  });
});
