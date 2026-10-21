// Exact decimal(18,2) values. Never pass legacy JSON numbers to these helpers:
// their precision may already have been lost during JSON parsing.
export const MAX_VND_MINOR_UNITS = 999_999_999_999_999_999n;
export const MIN_TRANSFER_MINOR_UNITS = 100_000n;

export function isVndDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(value);
}

export function parseVndMinorUnits(value: string): bigint {
  if (!isVndDecimal(value)) throw new RangeError('Invalid VND decimal string.');
  const [whole = '', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function normalizeVnd(value: string): string {
  const minorUnits = parseVndMinorUnits(value);
  return `${minorUnits / 100n}.${String(minorUnits % 100n).padStart(2, '0')}`;
}

export function formatVnd(value: string): string {
  const [whole = '', fraction = ''] = normalizeVnd(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction} VND`;
}
