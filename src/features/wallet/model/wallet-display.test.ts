import { describe, expect, it } from 'vitest';

import { formatWalletBalance, formatWalletUpdatedAt } from './wallet-display';

describe('legacy wallet display', () => {
  it('shows whole VND snapshots without decimal zeros', () => {
    expect(formatWalletBalance(0)).toBe('0');
    expect(formatWalletBalance(1234567)).toBe('1,234,567');
  });

  it.each([-1, Infinity, NaN, 1234567.5, 0.29, 0.001, 0.1 + 0.2, Number.MAX_SAFE_INTEGER + 1])(
    'does not round or fabricate unsupported balance %s',
    (value) => expect(() => formatWalletBalance(value)).toThrow(RangeError),
  );

  it('formats the Vietnam wall clock without converting to the browser timezone', () => {
    expect(formatWalletUpdatedAt('2026-10-21T14:30:00.123456')).toBe(
      'Oct 21, 2026, 14:30:00 (GMT+7)',
    );
    expect(() => formatWalletUpdatedAt('2026-10-21T07:30:00Z')).toThrow();
  });
});
