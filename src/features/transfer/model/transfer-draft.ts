import type { z } from 'zod';

import { transferRequestSchema } from '../api/transfer-schemas';

export type TransferDraft = {
  toEmail: string;
  amount: string;
  description: string | null;
};
export type TransferFieldName = keyof TransferDraft;
export type TransferReview = z.output<typeof transferRequestSchema>;

export function getTransferFieldError(name: TransferFieldName, value: string | null) {
  const result = transferRequestSchema.shape[name].safeParse(value);
  if (result.success) return undefined;
  if (name === 'toEmail') {
    if (!value?.trim()) return 'Enter the recipient email address.';
    if (value.trim().length > 255) return 'Use at most 255 characters for the email address.';
    return 'Enter a valid email address.';
  }
  if (name === 'description') return 'Use at most 255 characters for the description.';
  return result.error.issues[0]?.message;
}

export function createTransferReview(draft: TransferDraft): TransferReview {
  return transferRequestSchema.parse(draft);
}
