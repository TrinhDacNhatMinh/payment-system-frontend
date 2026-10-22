import { describe, expect, it } from 'vitest';

import { makeDepositOrder } from './deposit-fixture.test-support';
import {
  depositAmountInputSchema,
  depositOrderSchema,
  depositRequestSchema,
} from './deposit-schemas';

describe('deposit amount boundaries', () => {
  it.each([10000, 50000, 50000000])('accepts exact numeric amount %s on the wire', (amount) => {
    expect(depositRequestSchema.parse({ amount })).toEqual({ amount });
    expect(depositAmountInputSchema.parse(String(amount))).toBe(amount);
  });

  it.each([undefined, null, '10000', 9999, 50000001, 10000.5, NaN, Infinity])(
    'rejects unsupported request amount %s without coercion or rounding',
    (amount) => {
      expect(depositRequestSchema.safeParse({ amount }).success).toBe(false);
    },
  );

  it.each([
    '',
    '9999',
    '50000001',
    '10000.00',
    '10000.50',
    '1e4',
    '-10000',
    '+10000',
    '10,000',
    ' 10000 ',
    '9'.repeat(40),
  ])('rejects form input %s before conversion to number', (value) => {
    expect(depositAmountInputSchema.safeParse(value).success).toBe(false);
  });

  it('rejects unexpected fields and accepts numerically whole JSON numbers', () => {
    expect(depositRequestSchema.safeParse({ amount: 10000, userId: 2 }).success).toBe(false);
    expect(depositRequestSchema.parse(JSON.parse('{"amount":1e4}'))).toEqual({ amount: 10000 });
    expect(depositAmountInputSchema.parse('00010000')).toBe(10000);
  });
});

describe('deposit order views', () => {
  it('reads pending and terminal views without equating link expiry with failure', () => {
    const pending = makeDepositOrder();
    expect(depositOrderSchema.parse(pending).status).toBe('PENDING');
    expect(
      depositOrderSchema.parse({ ...pending, canContinuePayment: false, paymentUrl: null }).status,
    ).toBe('PENDING');
    for (const status of ['SUCCESS', 'FAILED']) {
      expect(
        depositOrderSchema.parse({
          ...pending,
          status,
          canContinuePayment: false,
          paymentUrl: null,
        }).status,
      ).toBe(status);
    }
  });

  it('preserves legacy nullable metadata and safe historical amounts above the creation limit', () => {
    const legacy = {
      ...makeDepositOrder(),
      amount: 50000001,
      status: 'SUCCESS',
      idempotencyKey: null,
      paymentUrlExpiresAt: null,
      paidAt: null,
      canContinuePayment: false,
      paymentUrl: null,
    };
    expect(depositOrderSchema.parse(legacy)).toEqual(legacy);
  });

  it.each([
    { amount: 10000.5 },
    { amount: '50000' },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { amount: 0 },
    { currency: 'USD' },
    { status: 'EXPIRED' },
    { orderId: '../auth/logout' },
    { idempotencyKey: 'not-a-key' },
    { createdAt: '2026-10-22T03:00:00Z' },
    { paymentUrlExpiresAt: '2026-10-22T10:00:00' },
    { canContinuePayment: false },
    { paymentUrl: null },
    { paymentUrlExpiresAt: null },
    { paidAt: '2026-10-22T10:01:00' },
    { status: 'SUCCESS' },
  ])('rejects an inconsistent or unsupported order view %j', (change) => {
    expect(depositOrderSchema.safeParse({ ...makeDepositOrder(), ...change }).success).toBe(false);
  });

  it('keeps microseconds and compares local timestamps without browser timezone conversion', () => {
    const order = {
      ...makeDepositOrder(),
      createdAt: '2026-10-22T10:00:00.123456',
      paymentUrlExpiresAt: '2026-10-22T10:00:00.123457',
    };
    expect(depositOrderSchema.parse(order).createdAt).toBe(order.createdAt);
    expect(
      depositOrderSchema.safeParse({ ...order, paymentUrlExpiresAt: order.createdAt }).success,
    ).toBe(false);
  });
});
