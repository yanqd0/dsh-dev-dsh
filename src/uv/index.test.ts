import { describe, expect, it, vi } from 'vitest';

import { UvConfigSchema } from './config.js';
import type { UvConfig } from './config.js';
import { installUv, installUvGuidance } from './index.js';
import { UV_GUIDANCE_ORDER, UV_TOOL_GUIDANCE } from './tool.js';
import type { DshContextLike, SubprocessSpawnSpecLike, SystemPromptSpecLike } from './types.js';

/** Config with production defaults, enabled. */
function config(overrides: Partial<UvConfig> = {}): UvConfig {
  return { ...UvConfigSchema.parse({ enabled: true }), ...overrides };
}

interface Host {
  ctx: DshContextLike;
  injected: string[][];
  /** Run every callback registered for a scope that provides the deps. */
  activate: (services: Record<string, unknown>) => void;
}

/** A host context that records scoped injections and can activate them. */
function host(): Host {
  const injected: string[][] = [];
  const callbacks: ((scope: DshContextLike) => void)[] = [];
  const ctx: DshContextLike = {
    get: () => undefined,
    inject: (deps, callback) => {
      injected.push([...deps]);
      callbacks.push(callback);
      return undefined;
    },
  };
  return {
    ctx,
    injected,
    activate: (services) => {
      const scope: DshContextLike = {
        get: (name) => services[name],
        inject: () => undefined,
      };
      for (const callback of callbacks) {
        callback(scope);
      }
    },
  };
}

/** The services a full web composition provides. */
function services(): Record<string, unknown> {
  return {
    tools: { register: () => (): void => {} },
    subprocess: {
      resolveExecutable: (command: string): Promise<string> => Promise.resolve(command),
      spawn: (_spec: SubprocessSpawnSpecLike) => ({
        collected: {},
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate: (): void => {},
      }),
    },
    approval: { request: () => Promise.resolve('allowed-once' as const) },
    systemPrompt: { context: () => (): void => {} },
  };
}

describe('installUv', () => {
  it('wires nothing when the submodule is disabled', () => {
    const fake = host();
    expect(installUv(fake.ctx, config({ enabled: false }))).toEqual({
      ok: true,
      reason: 'disabled',
    });
    expect(fake.injected).toEqual([]);
  });

  it('requests the tool, subprocess, and system-prompt scopes when enabled', () => {
    const fake = host();
    expect(installUv(fake.ctx, config())).toEqual({ ok: true });
    expect(fake.injected).toEqual([['tools', 'subprocess'], ['systemPrompt']]);
  });

  it('reports a wiring failure instead of throwing', () => {
    const ctx: DshContextLike = {
      get: () => undefined,
      inject: () => {
        throw new Error('context is disposed');
      },
    };
    expect(installUv(ctx, config())).toEqual({ ok: false, reason: 'context is disposed' });
  });

  it('keeps the plugin alive when the tool name is taken', () => {
    const fake = host();
    installUv(fake.ctx, config());
    const register = vi.fn(() => {
      throw new Error('tool "uv" is already registered');
    });
    expect(() => fake.activate({ ...services(), tools: { register } })).not.toThrow();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('installUvGuidance', () => {
  /** A scope whose systemPrompt records registrations. */
  function promptHost(kind: 'section' | 'context' | 'none'): {
    ctx: DshContextLike;
    sections: SystemPromptSpecLike[];
    contexts: SystemPromptSpecLike[];
  } {
    const sections: SystemPromptSpecLike[] = [];
    const contexts: SystemPromptSpecLike[] = [];
    const systemPrompt: Record<string, unknown> = {
      context: (spec: SystemPromptSpecLike) => {
        contexts.push(spec);
        return (): void => {};
      },
    };
    if (kind === 'section') {
      systemPrompt.section = (spec: SystemPromptSpecLike) => {
        sections.push(spec);
        return (): void => {};
      };
    }
    const ctx: DshContextLike = {
      get: () => (kind === 'none' ? undefined : systemPrompt),
      inject: () => undefined,
    };
    return { ctx, sections, contexts };
  }

  it('uses the stable section when the host exposes it', () => {
    const fake = promptHost('section');
    installUvGuidance(fake.ctx);
    expect(fake.sections).toEqual([
      { name: 'uv:tool-first', order: UV_GUIDANCE_ORDER, text: UV_TOOL_GUIDANCE },
    ]);
    expect(fake.contexts).toEqual([]);
  });

  it('falls back to context on leaner hosts', () => {
    const fake = promptHost('context');
    installUvGuidance(fake.ctx);
    expect(fake.contexts).toHaveLength(1);
    expect(fake.contexts[0]?.text).toBe(UV_TOOL_GUIDANCE);
  });

  it('does nothing without a systemPrompt service', () => {
    const fake = promptHost('none');
    expect(() => installUvGuidance(fake.ctx)).not.toThrow();
    expect(fake.contexts).toEqual([]);
    expect(fake.sections).toEqual([]);
  });
});
