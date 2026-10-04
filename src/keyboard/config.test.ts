import { describe, expect, it } from 'vitest';

import { KeyboardConfigSchema } from './config.ts';

describe('keyboard submodule config', () => {
  it('defaults to disabled so the 0.1.0 behaviour is unchanged', () => {
    expect(KeyboardConfigSchema.parse({}).enabled).toBe(false);
  });

  it('accepts an explicit enable from the mount line', () => {
    expect(KeyboardConfigSchema.parse({ enabled: true }).enabled).toBe(true);
  });

  it('rejects unknown keys instead of silently ignoring a typo', () => {
    expect(() => KeyboardConfigSchema.parse({ enable: true })).toThrow();
  });
});
