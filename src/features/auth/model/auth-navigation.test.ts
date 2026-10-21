import { describe, expect, it } from 'vitest';

import { getAuthReturnTo } from './auth-navigation';

describe('auth return destination', () => {
  it('accepts only the implemented private routes', () => {
    expect(getAuthReturnTo('/wallet')).toBe('/wallet');
    expect(getAuthReturnTo('/transfer')).toBe('/transfer');
  });

  it.each([
    undefined,
    null,
    'https://other.example',
    '//other.example',
    '/login',
    '/wallet?password=secret',
    '/wallet#secret',
    '/wallet/../login',
    '/transfer?amount=1000',
    '/transfer#receipt',
    '/transfer/../login',
    '//transfer',
    '/transactions',
    { path: '/wallet' },
  ])('does not forward arbitrary destinations or payloads', (value) => {
    expect(getAuthReturnTo(value)).toBeUndefined();
  });
});
