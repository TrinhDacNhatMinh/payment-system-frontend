import { describe, expect, it } from 'vitest';

import { formatVnd, MAX_VND_MINOR_UNITS, normalizeVnd, parseVndMinorUnits } from './vnd';

describe('exact VND strings', () => {
  it('preserves every digit at the decimal(18,2) maximum', () => {
    expect(parseVndMinorUnits('9999999999999999.99')).toBe(MAX_VND_MINOR_UNITS);
    expect(formatVnd('9999999999999999.99')).toBe('9,999,999,999,999,999.99 VND');
  });

  it('normalizes equivalent amounts without floating point or rounding', () => {
    expect(normalizeVnd('001000.5')).toBe('1000.50');
    expect(normalizeVnd('1000')).toBe(normalizeVnd('1000.00'));
    expect(parseVndMinorUnits('0.29')).toBe(29n);
    expect(formatVnd('0')).toBe('0.00 VND');
  });

  it.each([
    '1000.001',
    '-1000',
    '+1000',
    ' 1000',
    '1000 ',
    '1e3',
    '1,000',
    '',
    '1.',
    '.50',
    '10000000000000000',
    '0.000',
  ])('rejects unsupported representation %s', (value) => {
    expect(() => parseVndMinorUnits(value)).toThrow(RangeError);
    expect(() => formatVnd(value)).toThrow(RangeError);
  });
});
