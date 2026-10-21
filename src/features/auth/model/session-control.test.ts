import { describe, expect, it } from 'vitest';

import { parseAuthControl } from './session-control';

const control = { version: 1, epoch: '00000000-0000-4000-8000-000000000001', mode: 'active' };

describe('non-secret session control marker', () => {
  it('distinguishes first visit, valid control and malformed storage', () => {
    expect(parseAuthControl(null)).toBeNull();
    expect(parseAuthControl(JSON.stringify(control))).toEqual(control);
    expect(parseAuthControl('broken JSON')).toBe('invalid');
  });

  it.each([
    { ...control, accessToken: 'not-allowed' },
    { ...control, email: 'not-allowed@example.com' },
    { ...control, password: 'not-allowed' },
    { ...control, mode: 'authenticated' },
    { ...control, epoch: 'not-a-uuid' },
    { ...control, version: 2 },
  ])('rejects secrets, unexpected fields and unknown control values', (value) => {
    expect(parseAuthControl(JSON.stringify(value))).toBe('invalid');
  });
});
