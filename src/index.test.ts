import { describe, expect, it } from 'vitest';

import { name } from './index.ts';

describe('dsh-dev-dsh plugin entry', () => {
  it('exposes the mount id used by cordis.patch.yml', () => {
    expect(name).toBe('dsh-dev-dsh');
  });
});
