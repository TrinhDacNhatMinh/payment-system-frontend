import { describe, expect, it } from 'vitest';

import {
  createTransferReview,
  getTransferFieldError,
  getTransferBalanceError,
} from './transfer-draft';

describe('transfer review snapshot', () => {
  it('checks whole amounts against a known safe balance without rounding or inventing zero', () => {
    expect(getTransferBalanceError('2001', 2000)).toBe('Amount exceeds your available balance.');
    expect(getTransferBalanceError('2000', 2000)).toBeUndefined();
    expect(getTransferBalanceError('1000', 0)).toBeDefined();
    expect(getTransferBalanceError('1000', undefined)).toBeUndefined();
    expect(getTransferBalanceError('1000', 1000.5)).toBeUndefined();
    expect(getTransferBalanceError('1000', Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });
  it.each([null, '', '  lunch  ', ' '.repeat(255)])(
    'trims only email and preserves description %j',
    (description) => {
      const draft = { toEmail: ' Recipient@example.com ', amount: '001000', description };
      const review = createTransferReview(draft);
      expect(review).toEqual({ ...draft, toEmail: 'Recipient@example.com' });
      draft.amount = '2000';
      expect(review.amount).toBe('001000');
    },
  );

  it.each(['1000', '50000000'])('accepts the inclusive boundary %s', (amount) => {
    expect(getTransferFieldError('amount', amount)).toBeUndefined();
  });

  it.each(['', '999', '50000001', '1000.00', '1000.50', '+1000', '-1000', '1e3', '1,000'])(
    'rejects amount %s without coercion or rounding',
    (amount) => {
      expect(getTransferFieldError('amount', amount)).toBeDefined();
      expect(() =>
        createTransferReview({ toEmail: 'other@example.com', amount, description: null }),
      ).toThrow();
    },
  );

  it('validates recipient and description limits without truncating values', () => {
    expect(getTransferFieldError('toEmail', ' ')).toBe('Enter the recipient email address.');
    expect(getTransferFieldError('toEmail', 'bad')).toBe('Enter a valid email address.');
    expect(getTransferFieldError('toEmail', `${'x'.repeat(245)}@example.com`)).toContain('255');
    expect(getTransferFieldError('description', 'x'.repeat(255))).toBeUndefined();
    expect(getTransferFieldError('description', 'x'.repeat(256))).toContain('255');
  });
});
