/**
 * Minimal structural types for the DSH browser contracts the `keyboard`
 * submodule uses.
 *
 * Deliberately no `@deepseek-ai/*` imports and no dependency on the `DOM` lib:
 * the browser half is bundled into a self-contained module-loader factory (see
 * `scripts/build-client.mjs`) and must not request any module-table word, while
 * the package itself stays buildable outside the harness monorepo. These are
 * structural approximations of what we *consume* — the live DOM and the
 * live `ctx.shortcuts` service are wider objects that satisfy them. Keep them in
 * sync with the runtime facts the skill documents, not by guessing.
 */

/** Minimal event target consumed by the keyboard half. */
export interface EventTargetLike {
  addEventListener(type: string, listener: (event: unknown) => void, options?: object): void;
}

/** Minimal element face the card scan uses. */
export interface ElementLike {
  readonly className?: string | undefined;
  readonly tagName?: string | undefined;
  readonly contentEditable?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly parentNode?: ElementLike | null | undefined;
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  matches(selector: string): boolean;
  closest(selector: string): ElementLike | null;
  querySelectorAll(selector: string): readonly ElementLike[];
  getClientRects(): readonly object[];
  focus(): void;
  blur(): void;
  click(): void;
}

/** Minimal document face the card scan uses. */
export interface DocumentLike extends EventTargetLike {
  readonly body: ElementLike | null;
  readonly activeElement: ElementLike | null;
  querySelectorAll(selector: string): readonly ElementLike[];
  hasFocus(): boolean;
  createTreeWalker?(root: unknown): TreeWalkerLike;
}

/** Minimal tree-walker face used to enter shadow roots. */
export interface TreeWalkerLike {
  nextNode(): unknown;
  currentNode: unknown;
}

/** Minimal shadow-root face used to enter shadow roots. */
export interface ShadowRootLike {
  host: ElementLike;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

/** Minimal window face the keyboard half uses. */
export interface WindowLike extends EventTargetLike {
  readonly document: DocumentLike;
  readonly MutationObserver?: MutationObserverCtorLike | undefined;
}

/** Minimal mutation-observer face, read off the injected window. */
export interface MutationObserverCtorLike {
  new (callback: () => void): MutationObserverLike;
}

/** Minimal mutation-observer handle. */
export interface MutationObserverLike {
  observe(target: unknown, options: object): void;
  disconnect(): void;
}

/** Accepted physical combination of a fixed command (subset of `ShortcutBinding`). */
export interface ShortcutBindingLike {
  code: string;
  modifiers: readonly string[];
}

/** A fixed action contributed to the shortcut catalog. */
export interface ShortcutFixedCommandLike {
  id: string;
  label: () => string;
  keys: readonly string[];
  bindings: readonly ShortcutBindingLike[];
  group: 'application' | 'input' | 'menus' | 'approval';
}

/** One keydown as the shortcut adapter already arbitrated it. */
export interface ShortcutGestureLike {
  readonly code: string;
  readonly alt: boolean;
  readonly control: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly repeat: boolean;
  readonly composing: boolean;
  readonly defaultPrevented: boolean;
}

/** The input owner resolved before every delivered gesture. */
export interface ShortcutContextLike {
  readonly region: 'page' | 'editable' | 'terminal';
  /** Top-most modal identifier, `null` when no modal layer is open. */
  readonly modal: string | null;
}

/** A gesture delivered to a locally arbitrated fixed-input observer. */
export type ShortcutFixedInputLike =
  | {
      readonly type: 'keydown';
      readonly gesture: ShortcutGestureLike;
      readonly context: ShortcutContextLike;
      consume(): void;
    }
  | { readonly type: 'reset' };

/** The `ctx.shortcuts` service slice this submodule consumes. */
export interface ShortcutsLike {
  observeFixedInput(listener: (input: ShortcutFixedInputLike) => void): () => void;
  registerFixed(command: ShortcutFixedCommandLike): () => void;
}

/** The Cordis client context slice this submodule consumes. */
export interface ClientContextLike {
  get(name: string): unknown;
  inject(services: readonly string[], callback: (scope: ClientContextLike) => void): unknown;
  effect(callback: () => () => void, label?: string): unknown;
}
