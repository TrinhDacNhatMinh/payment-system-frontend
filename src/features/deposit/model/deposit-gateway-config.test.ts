import { describe, expect, it } from 'vitest';

import { parseDepositGatewayConfig } from './deposit-gateway-config';

describe('public deposit gateway configuration', () => {
  it('uses the API origin callback unless a trusted public backend callback is configured', () => {
    const values = { VITE_API_BASE_URL: 'http://localhost:8080', VITE_VNPAY_TMN_CODE: 'TESTCODE' };
    expect(parseDepositGatewayConfig(values)).toEqual({
      apiBaseUrl: 'http://localhost:8080',
      merchantCode: 'TESTCODE',
      returnUrl: undefined,
    });
    expect(
      parseDepositGatewayConfig({
        ...values,
        VITE_VNPAY_RETURN_URL: 'https://api.example.com/api/v1/payment/vnpay-return',
      }),
    ).toMatchObject({ returnUrl: 'https://api.example.com/api/v1/payment/vnpay-return' });
  });

  it.each([
    {},
    { VITE_API_BASE_URL: 'http://localhost:8080' },
    { VITE_API_BASE_URL: 'http://localhost:8080', VITE_VNPAY_TMN_CODE: '' },
    { VITE_API_BASE_URL: 'https://user:secret@example.com', VITE_VNPAY_TMN_CODE: 'TESTCODE' },
    { VITE_API_BASE_URL: 'http://localhost:8080', VITE_VNPAY_TMN_CODE: 'TEST CODE' },
    {
      VITE_API_BASE_URL: 'http://localhost:8080',
      VITE_VNPAY_TMN_CODE: 'TESTCODE',
      VITE_VNPAY_RETURN_URL: 'https://evil.test/callback',
    },
  ])(
    'disables payment for missing or invalid configuration without crashing other pages',
    (values) => {
      expect(parseDepositGatewayConfig(values)).toBeNull();
    },
  );
});
