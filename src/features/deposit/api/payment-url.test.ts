import { describe, expect, it } from 'vitest';

import { depositGatewayConfig, makeDepositOrder } from './deposit-fixture.test-support';
import { depositOrderSchema } from './deposit-schemas';
import { createPaymentUrlPolicy, validatePaymentUrl } from './payment-url';

const policy = createPaymentUrlPolicy(depositGatewayConfig);
function check(value: string) {
  validatePaymentUrl(
    depositOrderSchema.parse({ ...makeDepositOrder(), paymentUrl: value }),
    policy,
  );
}

describe('VNPay sandbox destination and order correlation', () => {
  it('accepts the stored signed URL including the explicit standard HTTPS port', () => {
    const order = makeDepositOrder();
    expect(() => check(order.paymentUrl)).not.toThrow();
    expect(() => check(order.paymentUrl.replace('.vn/', '.vn:443/'))).not.toThrow();
  });

  it.each([
    'http://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    'https://sandbox.vnpayment.vn.evil.test/paymentv2/vpcpay.html',
    'https://sandbox.vnpayment.vn@evil.test/paymentv2/vpcpay.html',
    'https://user:password@sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    'https://sandbox.vnpayment.vn:8443/paymentv2/vpcpay.html',
    'https://sandbox.vnpayment.vn/other',
    'https://sandbox.vnpayment.vn/paymentv2/%76pcpay.html',
    'javascript:alert(1)',
    '//sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  ])('rejects an unsupported destination %s', (destination) => {
    const query = makeDepositOrder().paymentUrl.split('?')[1];
    expect(() => check(`${destination}?${query}`)).toThrow(
      expect.objectContaining({ kind: 'protocol' }),
    );
  });

  it.each([
    ['vnp_TxnRef', 'VNPAY_OTHER'],
    ['vnp_Amount', '5000001'],
    ['vnp_TmnCode', 'OTHER'],
    ['vnp_ReturnUrl', 'https://evil.test/result'],
    ['vnp_CurrCode', 'USD'],
    ['vnp_Command', 'refund'],
    ['vnp_Version', '1.0'],
    ['vnp_CreateDate', '20261022030000'],
    ['vnp_ExpireDate', '20261022103000'],
    ['vnp_SecureHash', 'not-a-signature'],
  ])('rejects a mismatched %s without leaking the signed URL', (name, value) => {
    const url = new URL(makeDepositOrder().paymentUrl);
    url.searchParams.set(name, value);
    const failure = (() => {
      try {
        check(url.href);
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toMatchObject({ kind: 'protocol' });
    expect(String(failure)).not.toContain('vnp_SecureHash');
  });

  it('rejects missing or duplicate query parameters, fragments, whitespace and backslashes', () => {
    const original = makeDepositOrder().paymentUrl;
    for (const value of [
      original + '&vnp_Amount=5000000',
      original + '#fragment',
      ' ' + original,
      original.replace('/paymentv2/', '\\paymentv2/'),
    ]) {
      expect(() => check(value)).toThrow();
    }
    const missing = new URL(original);
    missing.searchParams.delete('vnp_ReturnUrl');
    expect(() => check(missing.href)).toThrow();
  });

  it('does not require or reconstruct a payment link for expired, terminal or legacy views', () => {
    const order = depositOrderSchema.parse({
      ...makeDepositOrder(),
      paymentUrl: null,
      canContinuePayment: false,
      paymentUrlExpiresAt: null,
    });
    expect(() => validatePaymentUrl(order, policy)).not.toThrow();
    expect(order.status).toBe('PENDING');
  });

  it('fails closed on invalid public configuration without echoing credentials', () => {
    expect(() => createPaymentUrlPolicy({ ...depositGatewayConfig, merchantCode: '' })).toThrow();
    try {
      createPaymentUrlPolicy({
        ...depositGatewayConfig,
        apiBaseUrl: 'https://user:secret@api.test',
      });
      throw new Error('Configuration was accepted');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'client' });
      expect(String(error)).not.toContain('secret');
    }
  });

  it('supports an explicitly configured public callback and rejects callback query injection', () => {
    const returnUrl = 'https://api.example.com/api/v1/payment/vnpay-return';
    const publicPolicy = createPaymentUrlPolicy({ ...depositGatewayConfig, returnUrl });
    const url = new URL(makeDepositOrder().paymentUrl);
    url.searchParams.set('vnp_ReturnUrl', returnUrl);
    const view = depositOrderSchema.parse({ ...makeDepositOrder(), paymentUrl: url.href });
    expect(() => validatePaymentUrl(view, publicPolicy)).not.toThrow();
    expect(() => validatePaymentUrl(view, policy)).toThrow();
    expect(() =>
      createPaymentUrlPolicy({ ...depositGatewayConfig, returnUrl: returnUrl + '?next=evil' }),
    ).toThrow();
  });
});
