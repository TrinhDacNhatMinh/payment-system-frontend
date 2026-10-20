import { describe, expect, it } from 'vitest';

import { getAuthReturnTo } from './auth-navigation';

describe('auth return destination', () => {
  it('accepts the implemented private route', () => {
    expect(getAuthReturnTo('/wallet')).toBe('/wallet');
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
    { path: '/wallet' },
  ])('does not forward arbitrary destinations or payloads', (value) => {
    expect(getAuthReturnTo(value)).toBeUndefined();
  });
});
