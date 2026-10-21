import { describe, expect, it } from 'vitest';

import {
  idempotencyKeySchema,
  transferAmountSchema,
  transferLookupSchema,
  transferRequestSchema,
  transferResponseSchema,
} from './transfer-schemas';

const key = '550e8400-e29b-41d4-a716-446655440000';
const request = { toEmail: 'Recipient@example.com', amount: '1000.50', description: null };
const receipt = {
  transactionId: 1,
  fromWalletBalance: '0.00',
  amount: '1000.50',
  status: 'SUCCESS',
  createdAt: '2026-10-21T14:30:00.123456',
};

describe('transfer runtime contract', () => {
  it.each(['1000', '1000.5', '1000.50', '9999999999999999.99'])(
    'accepts exact amount %s',
    (amount) => expect(transferAmountSchema.parse(amount)).toBe(amount),
  );

  it.each([
    1000,
    1000.5,
    null,
    '999.99',
    '0',
    '10000000000000000',
    '1000.001',
    '1e3',
    '1,000',
    '+1000',
    '-1000',
    ' 1000',
    '1000 ',
  ])('rejects invalid amount %s', (amount) => {
    expect(transferAmountSchema.safeParse(amount).success).toBe(false);
  });

  it('trims email while preserving its case and every description value', () => {
    for (const description of [null, '', '  lunch  ', ' '.repeat(255)]) {
      expect(
        transferRequestSchema.parse({
          ...request,
          toEmail: ' Recipient@example.com ',
          description,
        }),
      ).toEqual({ ...request, description });
    }
    expect(
      transferRequestSchema.parse({ toEmail: request.toEmail, amount: request.amount }),
    ).toEqual(request);
    expect(
      transferRequestSchema.safeParse({ ...request, description: 'x'.repeat(256) }).success,
    ).toBe(false);
    expect(
      transferRequestSchema.safeParse({ ...request, toEmail: `${'x'.repeat(256)}@example.com` })
        .success,
    ).toBe(false);
    expect(transferRequestSchema.safeParse({ ...request, toEmail: 'bad-email' }).success).toBe(
      false,
    );
  });

  it('accepts zero receipt balance and preserves Vietnam local time including microseconds', () => {
    expect(transferResponseSchema.parse(receipt)).toEqual(receipt);
    expect(transferResponseSchema.safeParse({ ...receipt, fromWalletBalance: 0 }).success).toBe(
      false,
    );
    expect(transferResponseSchema.safeParse({ ...receipt, fromWalletBalance: '-1' }).success).toBe(
      false,
    );
    for (const createdAt of [
      '2026-10-21T07:30:00Z',
      '2026-10-21T14:30:00+07:00',
      '2026-02-30T14:30:00',
    ]) {
      expect(transferResponseSchema.safeParse({ ...receipt, createdAt }).success).toBe(false);
    }
  });

  it('normalizes UUID casing and rejects non-v4 or injected keys', () => {
    expect(idempotencyKeySchema.parse(key.toUpperCase())).toBe(key);
    for (const value of [
      key.replace('-41d4-', '-11d4-'),
      `${key}\r\nAuthorization: leaked`,
      '../auth/login',
      `${key},${key}`,
    ]) {
      expect(idempotencyKeySchema.safeParse(value).success).toBe(false);
    }
  });

  it('requires a coherent lookup state and matching amount, without leaking server text', () => {
    const pending = { idempotencyKey: key, request, state: 'PENDING', result: null, error: null };
    expect(transferLookupSchema.parse(pending)).toEqual(pending);
    expect(transferLookupSchema.safeParse({ ...pending, result: receipt }).success).toBe(false);
    const success = { ...pending, state: 'SUCCEEDED', result: receipt };
    expect(transferLookupSchema.safeParse(success).success).toBe(true);
    expect(
      transferLookupSchema.safeParse({
        ...success,
        result: { ...receipt, amount: '2000' },
      }).success,
    ).toBe(false);
    expect(
      transferLookupSchema.safeParse({
        ...success,
        result: { ...receipt, amount: '1e3' },
      }).success,
    ).toBe(false);
    const rejected = {
      ...pending,
      state: 'REJECTED',
      error: {
        httpStatus: 400,
        code: 'WALLET_INSUFFICIENT_BALANCE',
        message: 'sensitive raw text',
      },
    };
    expect(JSON.stringify(transferLookupSchema.parse(rejected))).not.toContain(
      'sensitive raw text',
    );
    expect(
      transferLookupSchema.safeParse({
        ...rejected,
        error: { ...rejected.error, httpStatus: 500 },
      }).success,
    ).toBe(false);
    expect(transferLookupSchema.safeParse({ ...pending, state: 'FAILED' }).success).toBe(false);
  });
});
