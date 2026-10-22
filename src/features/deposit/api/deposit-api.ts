import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import { ApiError } from '@/shared/api/api-error';
import { idempotencyKeySchema } from '@/shared/api/idempotency-key';
import {
  depositOrderIdSchema,
  depositOrderSchema,
  depositRequestSchema,
  type DepositOrder,
  type DepositRequest,
} from './deposit-schemas';
import {
  createPaymentUrlPolicy,
  validatePaymentUrl,
  type DepositGatewayConfig,
} from './payment-url';

function parseKey(value: string) {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw new ApiError('client');
  return result.data;
}

// The flow owns key generation, persistence and explicit resume/redirect actions.
export function createDepositApi(
  privateApi: PrivateApiFactory,
  access: SessionAccess,
  config: DepositGatewayConfig,
) {
  const api = privateApi(access);
  const policy = createPaymentUrlPolicy(config);
  function validate(order: DepositOrder) {
    validatePaymentUrl(order, policy);
    return order;
  }
  return {
    async submit(request: DepositRequest, idempotencyKey: string, signal?: AbortSignal) {
      const key = parseKey(idempotencyKey);
      const payload = depositRequestSchema.safeParse(request);
      if (!payload.success) throw new ApiError('client');
      const result = await api.request(
        {
          method: 'POST',
          path: '/api/v1/payment/deposit',
          data: payload.data,
          idempotencyKey: key,
          signal,
        },
        depositOrderSchema,
      );
      if (result.idempotencyKey !== key || result.amount !== payload.data.amount)
        throw new ApiError('protocol');
      return validate(result);
    },
    async getOrder(orderId: string, signal?: AbortSignal) {
      const id = depositOrderIdSchema.safeParse(orderId);
      if (!id.success) throw new ApiError('client');
      const result = await api.request(
        { method: 'GET', path: `/api/v1/payment/orders/${encodeURIComponent(id.data)}`, signal },
        depositOrderSchema,
      );
      if (result.orderId !== id.data) throw new ApiError('protocol');
      return validate(result);
    },
    async getRequest(idempotencyKey: string, signal?: AbortSignal) {
      const key = parseKey(idempotencyKey);
      const result = await api.request(
        { method: 'GET', path: `/api/v1/payment/deposit/requests/${key}`, signal },
        depositOrderSchema,
      );
      if (result.idempotencyKey !== key) throw new ApiError('protocol');
      return validate(result);
    },
  };
}
