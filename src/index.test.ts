import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Config, apply, name } from './index.ts';
import type { DshContextLike } from './uv/types.ts';

vi.mock('./install-skill.js', () => ({ installSkill: vi.fn(() => ({ ok: true })) }));

const { installSkill } = await import('./install-skill.js');

/** A host context that records scoped injections without providing services. */
function host(): { ctx: DshContextLike; injected: string[][] } {
  const injected: string[][] = [];
  return {
    injected,
    ctx: {
      get: () => undefined,
      inject: (deps, _callback) => {
        injected.push([...deps]);
        return undefined;
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(installSkill).mockClear();
});

describe('dsh-dev-dsh plugin entry', () => {
  it('exposes the mount id used by cordis.patch.yml', () => {
    expect(name).toBe('dsh-dev-dsh');
  });

  it('defaults autoInstallSkill to true and the uv submodule to off', () => {
    const config = Config.parse({});
    expect(config.autoInstallSkill).toBe(true);
    expect(config.uv.enabled).toBe(false);
    expect(config.uv.grant).toBe('session');
  });

  it('syncs the bundled skill on load', () => {
    apply(host().ctx, Config.parse({}));
    expect(installSkill).toHaveBeenCalledTimes(1);
  });

  it('skips the sync when autoInstallSkill is false', () => {
    apply(host().ctx, Config.parse({ autoInstallSkill: false }));
    expect(installSkill).not.toHaveBeenCalled();
  });

  it('does not touch host services while the uv submodule is disabled', () => {
    const fake = host();
    apply(fake.ctx, Config.parse({}));
    expect(fake.injected).toEqual([]);
  });

  it('wires the uv submodule when the profile enables it', () => {
    const fake = host();
    apply(fake.ctx, Config.parse({ uv: { enabled: true } }));
    expect(fake.injected).toEqual([['tools', 'subprocess'], ['systemPrompt']]);
  });
});
