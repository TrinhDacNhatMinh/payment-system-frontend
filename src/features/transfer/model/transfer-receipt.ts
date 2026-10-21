import { vietnamDateTimeSchema } from '@/shared/api/scalar-schemas';
import { formatVnd, parseVndMinorUnits } from '@/shared/lib/vnd';

// Lookup may return an immutable historical fraction. Never round it into whole VND.
export function formatReceiptMoney(value: string) {
  const units = parseVndMinorUnits(value);
  const whole = (units / 100n).toString();
  if (units % 100n === 0n) return formatVnd(whole);
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(units % 100n).padStart(2, '0')} VND`;
}

export function formatReceiptTime(value: string) {
  const local = vietnamDateTimeSchema.parse(value);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  // The API already supplies Vietnam local time; do not convert using the browser timezone.
  const day = Number(local.slice(8, 10));
  const month = months[Number(local.slice(5, 7)) - 1];
  return `${day} ${month} ${local.slice(0, 4)}, ${local.slice(11, 16)}`;
}
