import { describe, expect, it, vi } from 'vitest';

import { createTransferMarkerStore } from './transfer-marker';
import { formatReceiptMoney, formatReceiptTime } from './transfer-receipt';

const key = '550e8400-e29b-41d4-a716-446655440000';
function setup(value: string | null = null) {
  let stored = value;
  const storage = {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((...args: [string, string]) => {
      stored = args[1];
    }),
    removeItem: vi.fn(() => {
      stored = null;
    }),
  };
  return { storage, markers: createTransferMarkerStore(() => storage) };
}

describe('transfer recovery marker', () => {
  it('does not overwrite an existing intent or delete a different key', () => {
    const { markers } = setup();
    markers.save({ userId: 1, idempotencyKey: key });
    const other = { userId: 1, idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' };
    expect(() => markers.save(other)).toThrow();
    expect(() => markers.clear(other)).toThrow();
    expect(markers.read()).toEqual({ userId: 1, idempotencyKey: key });
    markers.ensureOwner(2);
    expect(markers.read()).toBeNull();
  });

  it.each([
    'invalid JSON',
    '{}',
    JSON.stringify({ userId: 1, idempotencyKey: key, amount: '1000' }),
  ])('fails closed on an invalid or payload-bearing marker %s', (value) =>
    expect(() => setup(value).markers.read()).toThrow(),
  );

  it('verifies persistence instead of trusting a silent storage write', () => {
    const { storage, markers } = setup();
    storage.setItem.mockImplementation(() => undefined);
    expect(() => markers.save({ userId: 1, idempotencyKey: key })).toThrow();
  });
});

describe('immutable receipt presentation', () => {
  it('formats whole and historical fractional amounts without precision loss', () => {
    expect(formatReceiptMoney('1000')).toBe('1,000 VND');
    expect(formatReceiptMoney('0')).toBe('0 VND');
    expect(formatReceiptMoney('9999999999999999.99')).toBe('9,999,999,999,999,999.99 VND');
    expect(formatReceiptMoney('1000.50')).toBe('1,000.50 VND');
  });
  it('displays Vietnam local time to the minute without browser timezone conversion', () => {
    expect(formatReceiptTime('2026-10-21T14:30:00.123456')).toBe('21 Oct 2026, 14:30');
    expect(formatReceiptTime('2026-01-02T00:05:59')).toBe('2 Jan 2026, 00:05');
    expect(() => formatReceiptTime('2026-10-21T07:30:00Z')).toThrow();
  });
});
