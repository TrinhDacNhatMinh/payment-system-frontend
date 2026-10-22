import { describe, expect, it } from 'vitest';

import { getPaymentResultReturnTo, parsePaymentResultSearch } from './payment-result-context';

describe('payment result context', () => {
  it('keeps only a validated order ID and discards untrusted payment outcomes and signed URLs', () => {
    const value = {
      orderId: 'VNPAY_123',
      status: 'SUCCESS',
      amount: 50000,
      paymentUrl: 'https://evil.test',
      vnp_SecureHash: 'sensitive',
    };
    expect(parsePaymentResultSearch(value)).toEqual({ orderId: 'VNPAY_123' });
    expect(getPaymentResultReturnTo(value)).toBe('/payment/result?orderId=VNPAY_123');
  });

  it.each([
    { orderId: ['VNPAY_1', 'VNPAY_2'] },
    { orderId: { id: 'VNPAY_1' } },
    { orderId: '../wallet' },
    { orderId: 'VNPAY_1?token=secret' },
    { orderId: '' },
    { orderId: 'x'.repeat(101) },
    { verification: 'success' },
    { verification: ['invalid', 'unavailable'] },
  ])('rejects malformed or ambiguous context %j', (value) => {
    expect(parsePaymentResultSearch(value)).toEqual({ verification: 'invalid' });
    expect(getPaymentResultReturnTo(value)).toBeUndefined();
  });

  it.each(['invalid', 'unavailable'])(
    'does not carry an order through a %s return',
    (verification) => {
      expect(parsePaymentResultSearch({ orderId: 'VNPAY_1', verification })).toEqual({
        verification,
      });
      expect(getPaymentResultReturnTo({ orderId: 'VNPAY_1', verification })).toBeUndefined();
    },
  );

  it('does not fabricate an order for an empty or outcome-only result URL', () => {
    expect(parsePaymentResultSearch({})).toEqual({});
    expect(parsePaymentResultSearch({ status: 'SUCCESS' })).toEqual({});
    expect(getPaymentResultReturnTo({ status: 'SUCCESS' })).toBeUndefined();
  });
});
