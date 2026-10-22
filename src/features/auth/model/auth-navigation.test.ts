import { describe, expect, it } from 'vitest';

import { getAuthNavigationTarget, getAuthReturnTo } from './auth-navigation';

describe('auth return destination', () => {
  it('accepts only the implemented private routes', () => {
    expect(getAuthReturnTo('/wallet')).toBe('/wallet');
    expect(getAuthReturnTo('/transfer')).toBe('/transfer');
    expect(getAuthReturnTo('/deposit')).toBe('/deposit');
    expect(getAuthReturnTo('/payment/result?orderId=VNPAY_123')).toBe(
      '/payment/result?orderId=VNPAY_123',
    );
    expect(getAuthNavigationTarget('/payment/result?orderId=VNPAY_123')).toEqual({
      to: '/payment/result',
      search: { orderId: 'VNPAY_123' },
    });
    expect(getAuthNavigationTarget('https://evil.test', '/login')).toEqual({ to: '/login' });
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
    '/deposit?amount=50000',
    '/payment/result?orderId=VNPAY_1&orderId=VNPAY_2',
    '/payment/result?orderId=VNPAY_1&status=SUCCESS',
    '/payment/result?orderId=VNPAY_1&paymentUrl=https://evil.test',
    '/payment/result?orderId=../wallet',
    '/payment/result?orderId=VNPAY_1#token',
    '/payment/result?verification=invalid',
  ])('does not forward arbitrary destinations or payloads', (value) => {
    expect(getAuthReturnTo(value)).toBeUndefined();
  });
});
