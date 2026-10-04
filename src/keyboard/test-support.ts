/**
 * jsdom bridge for the keydown-path specs.
 *
 * `src/keyboard/` types the document through its own minimal interfaces so the
 * browser half needs no `@deepseek-ai/*` import. jsdom elements satisfy those
 * interfaces at runtime; these helpers make them satisfy at the type level and
 * wrap them once so identity comparisons (the focused element versus a scanned
 * option) stay meaningful.
 *
 * The jsdom surface the bridge drives is declared here rather than pulled from
 * the `DOM` lib: the package targets Node and the browser half carries its own
 * structural types, so a global lib would only widen what this package claims
 * to know.
 */

import type { DocumentLike, ElementLike, WindowLike } from './types.ts';

const wrappers = new WeakMap<object, ElementLike>();

/** Minimal jsdom element face. */
interface NativeElement {
  readonly tagName?: string;
  readonly className?: string;
  readonly contentEditable?: string;
  readonly disabled?: boolean;
  readonly parentElement: NativeElement | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: (event: object) => void): void;
  matches(selector: string): boolean;
  closest(selector: string): NativeElement | null;
  querySelector(selector: string): NativeElement | null;
  querySelectorAll(selector: string): ArrayLike<NativeElement>;
  getClientRects(): ArrayLike<object>;
  focus(): void;
  click(): void;
  blur(): void;
}

/** Minimal jsdom document face. */
interface NativeDocument {
  readonly body: NativeElement | null;
  readonly activeElement: NativeElement | null;
  addEventListener(type: string, listener: (event: object) => void, options?: object): void;
  querySelector(selector: string): NativeElement | null;
  querySelectorAll(selector: string): ArrayLike<NativeElement>;
  hasFocus(): boolean;
}

/** Minimal jsdom window face. */
interface NativeWindow {
  readonly document: NativeDocument;
  readonly MutationObserver?: unknown;
  addEventListener(type: string, listener: (event: object) => void, options?: object): void;
}

/** Read the ambient jsdom surface through the slice declared above. */
const asElement = (value: unknown): NativeElement => value as NativeElement;

/** Read a jsdom document through the slice declared above. */
const asDocument = (value: unknown): NativeDocument => value as NativeDocument;

/** Read a jsdom window through the slice declared above. */
const asWindow = (value: unknown): NativeWindow => value as NativeWindow;

/** The ambient jsdom window, typed through the slice the module consumes. */
export const rawWindow = globalThis.window as unknown as WindowLike;

/** The ambient jsdom document, typed through the slice the module consumes. */
export const rawDocument = rawWindow.document;

/** The ambient jsdom document as the bridge drives it. */
export const nativeDoc = asDocument(globalThis.document);

/**
 * Wrap a jsdom element in the structural element interface used by the module.
 *
 * @param target - the live jsdom element.
 * @returns the cached wrapper for that element.
 */
export function wrapElement(target: unknown): ElementLike {
  if (target === null || target === undefined) throw new Error('wrapElement needs an element');
  const element = asElement(target);
  if (typeof element.matches !== 'function') throw new Error('wrapElement needs a real element');
  const cached = wrappers.get(element);
  if (cached !== undefined) return cached;
  const wrapper: ElementLike = {
    get className() {
      return element.className;
    },
    get tagName() {
      return element.tagName;
    },
    get contentEditable() {
      return element.contentEditable;
    },
    get disabled() {
      return element.disabled === true;
    },
    get parentNode() {
      const parent = element.parentElement;
      return parent === null ? null : wrapElement(parent);
    },
    getAttribute: (name) => element.getAttribute(name),
    addEventListener: (type, listener) => {
      element.addEventListener(type, listener);
    },
    matches: (selector) => element.matches(selector),
    closest: (selector) => {
      const found = element.closest(selector);
      return found === null ? null : wrapElement(found);
    },
    querySelectorAll: (selector) =>
      Array.from(element.querySelectorAll(selector)).map((node) => wrapElement(node)),
    getClientRects: () => Array.from(element.getClientRects()),
    focus: () => {
      element.focus();
    },
    blur: () => {
      element.blur();
    },
    click: () => {
      element.click();
    },
  };
  wrappers.set(element, wrapper);
  return wrapper;
}

/**
 * Adapt a jsdom document to the structural document interface.
 *
 * `body` and `activeElement` stay native on purpose: the observer target must be
 * a real `Node`, and the wrapper's `parentNode` already handles unwrapping.
 *
 * @param ownerDocument - the jsdom document.
 * @returns the document as the module sees it.
 */
export function wrapDocument(ownerDocument: DocumentLike): DocumentLike {
  const doc = asDocument(ownerDocument);
  return {
    addEventListener: (type, listener, options) => {
      doc.addEventListener(type, listener, options);
    },
    body: ownerDocument.body,
    activeElement: doc.activeElement === null ? null : wrapElement(doc.activeElement),
    querySelectorAll: (selector) =>
      Array.from(doc.querySelectorAll(selector)).map((node) => wrapElement(node)),
    hasFocus: () => doc.hasFocus(),
  };
}

/**
 * Adapt the ambient jsdom window, including its `MutationObserver`.
 *
 * @param ownerWindow - the jsdom window.
 * @returns the window as the module sees it.
 */
export function wrapWindow(ownerWindow: unknown = globalThis.window): WindowLike {
  const source = asWindow(ownerWindow);
  return {
    addEventListener: (type, listener, options) => {
      source.addEventListener(type, listener, options);
    },
    document: wrapDocument(source.document as unknown as DocumentLike),
    ...(source.MutationObserver === undefined
      ? {}
      : {
          MutationObserver: source.MutationObserver as NonNullable<WindowLike['MutationObserver']>,
        }),
  };
}

/**
 * Build one of the three shipped takeover cards as markup.
 *
 * `className` values mirror the CSS-Modules hashes the components render
 * (`_primary_<hash>`); the hash itself is arbitrary here because the module
 * only matches the `_primary_` prefix.
 *
 * @param kind - which card flavour to render.
 * @returns the card's outer HTML.
 */
export function cardMarkup(kind: 'approval' | 'plan-review' | 'question'): string {
  if (kind === 'approval') {
    return `<div class="_root_1" data-approval-key="call-1">
      <div class="_body_1" data-approval-scroll=""></div>
      <div class="_actionRow_1">
        <button class="_button_1 _outline_1">拒绝</button>
        <button class="_button_1 _primary_1">允许一次</button>
      </div>
    </div>`;
  }
  if (kind === 'plan-review') {
    return `<div class="_frame_1" data-plan-review-key="plan-1">
      <section class="_card_2" aria-busy="false">
        <div class="_summary_1" data-question-scroll></div>
        <div class="_footer_1">
          <div class="_actions_1">
            <button class="_button_2 _outline_2">继续讨论</button>
            <button class="_button_2 _primary_2">Approve</button>
          </div>
        </div>
      </section>
    </div>`;
  }
  return `<div class="_frame_3" data-question-key="q-1">
    <div class="_body_3" data-question-scroll="">
      <div class="_options_3" role="radiogroup">
        <button class="_option_3" role="radio" aria-checked="true">推荐项</button>
        <button class="_option_3" role="radio" aria-checked="false">其它项</button>
        <button class="_option_3" role="radio" aria-checked="false" disabled>不可选项</button>
      </div>
    </div>
    <div class="_footerActions_3">
      <button class="_button_3 _outline_3">跳过</button>
      <button class="_button_3 _primary_3" disabled>继续</button>
    </div>
  </div>`;
}

/**
 * Replace the document body with one fixture.
 *
 * @param markup - the fixture markup.
 * @returns the body element.
 */
export function mount(markup: string): ElementLike {
  const body = asElement(nativeDoc.body);
  body.innerHTML = markup;
  return wrapElement(body);
}
