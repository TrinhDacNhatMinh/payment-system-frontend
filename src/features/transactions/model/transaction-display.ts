import { formatVnd } from '@/shared/lib/vnd';
import { transactionDateTimeSchema, type TransactionResponse } from '../api/transaction-schemas';

const TYPE_LABELS = {
  DEPOSIT: 'Top up',
  TRANSFER_IN: 'Transfer received',
  TRANSFER_OUT: 'Transfer sent',
};

const STATUS_LABELS = {
  PENDING: 'Pending',
  SUCCESS: 'Completed',
  FAILED: 'Failed',
};

export function formatTransactionTime(value: string) {
  const local = transactionDateTimeSchema.parse(value);
  // The application sets the JVM timezone to Asia/Ho_Chi_Minh. Preserve the
  // API's local clock fields, including for browsers in another timezone.
  return `${local.slice(11, 16)} ${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)}`;
}

export function transactionDisplay(transaction: TransactionResponse) {
  if (!Number.isSafeInteger(transaction.amount) || transaction.amount < 0) {
    throw new RangeError('Unsupported transaction amount.');
  }
  const money = formatVnd(String(transaction.amount));
  const direction =
    transaction.status !== 'SUCCESS'
      ? 'neutral'
      : transaction.type === 'TRANSFER_OUT'
        ? 'outgoing'
        : 'incoming';
  const isOutgoing = transaction.type === 'TRANSFER_OUT';
  const prefix = transaction.status === 'FAILED' ? '' : isOutgoing ? '−' : '+';
  const amountLabel =
    transaction.status === 'PENDING'
      ? `Pending ${isOutgoing ? 'outgoing' : 'incoming'} amount`
      : direction === 'incoming'
        ? 'Received'
        : direction === 'outgoing'
          ? 'Sent'
          : 'Amount';
  return {
    id: transaction.id,
    type: TYPE_LABELS[transaction.type],
    status: transaction.status,
    statusLabel: STATUS_LABELS[transaction.status],
    amount: `${prefix}${money}`,
    amountLabel: `${amountLabel}: ${money}`,
    direction,
    description: transaction.description?.trim() ? transaction.description : null,
    createdAt: transaction.createdAt,
    time: formatTransactionTime(transaction.createdAt),
  };
}

export type TransactionDisplay = ReturnType<typeof transactionDisplay>;
