import { vietnamDateTimeSchema } from '@/shared/api/scalar-schemas';

// This is display of the legacy numeric wallet snapshot, not conversion to
// exact transfer money. Reject fractions instead of rounding them.
export function formatWalletBalance(balance: number): string {
  const value = String(balance);
  if (
    !Number.isSafeInteger(balance) ||
    balance < 0 ||
    balance > Number.MAX_SAFE_INTEGER ||
    !/^[0-9]{1,16}$/.test(value)
  ) {
    throw new RangeError('The wallet balance cannot be displayed safely.');
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatWalletUpdatedAt(value: string): string {
  const local = vietnamDateTimeSchema.parse(value);
  const year = local.slice(0, 4);
  const month = MONTHS[Number(local.slice(5, 7)) - 1];
  const day = local.slice(8, 10);
  return `${month} ${day}, ${year}, ${local.slice(11, 19)} (GMT+7)`;
}
