import { parseVndMinorUnits } from '@/shared/lib/vnd';
import { transferRequestSchema, type TransferLookup } from '../api/transfer-schemas';
import type { TransferReview } from './transfer-draft';

// Old whole-valued decimals may be resumed as integers. Fractions and amounts
// outside the current POST contract remain read-only; never round or clamp them.
export function recoverTransferReview(request: TransferLookup['request']): TransferReview | null {
  const units = parseVndMinorUnits(request.amount);
  if (units % 100n !== 0n) return null;
  const parsed = transferRequestSchema.safeParse({
    ...request,
    amount: (units / 100n).toString(),
  });
  return parsed.success ? parsed.data : null;
}

export function matchesTransferReview(
  left: TransferLookup['request'],
  right: TransferLookup['request'],
) {
  return (
    left.toEmail === right.toEmail &&
    parseVndMinorUnits(left.amount) === parseVndMinorUnits(right.amount) &&
    left.description === right.description
  );
}
