import { describe, expect, it, vi } from 'vitest';

import { KEYBOARD_DISABLED_NOTE, installKeyboard } from './host.ts';

describe('keyboard submodule host wiring', () => {
  it('wires nothing and reports the disabled state', () => {
    const log = vi.fn();
    expect(installKeyboard({ enabled: false }, log)).toEqual({ ok: true, reason: 'disabled' });
    expect(log).toHaveBeenCalledWith(KEYBOARD_DISABLED_NOTE);
  });

  it('is a silent no-op when the profile enables the submodule', () => {
    const log = vi.fn();
    expect(installKeyboard({ enabled: true }, log)).toEqual({ ok: true });
    expect(log).not.toHaveBeenCalled();
  });
});
