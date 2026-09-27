import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Config, apply, name } from './index.ts';

vi.mock('./install-skill.js', () => ({ installSkill: vi.fn(() => ({ ok: true })) }));

const { installSkill } = await import('./install-skill.js');

beforeEach(() => {
  vi.mocked(installSkill).mockClear();
});

describe('dsh-dev-dsh plugin entry', () => {
  it('exposes the mount id used by cordis.patch.yml', () => {
    expect(name).toBe('dsh-dev-dsh');
  });

  it('defaults autoInstallSkill to true', () => {
    expect(Config.parse({})).toEqual({ autoInstallSkill: true });
  });

  it('syncs the bundled skill on load', () => {
    apply({}, Config.parse({}));
    expect(installSkill).toHaveBeenCalledTimes(1);
  });

  it('skips the sync when autoInstallSkill is false', () => {
    apply({}, Config.parse({ autoInstallSkill: false }));
    expect(installSkill).not.toHaveBeenCalled();
  });
});
