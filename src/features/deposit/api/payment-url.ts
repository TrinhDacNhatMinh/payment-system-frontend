import { ApiError } from '@/shared/api/api-error';
import { parseEnvironment } from '@/shared/config/env-schema';
import type { DepositOrder } from './deposit-schemas';

export type DepositGatewayConfig = {
  apiBaseUrl: string;
  merchantCode: string;
  returnUrl?: string;
};

export function createPaymentUrlPolicy(config: DepositGatewayConfig) {
  try {
    const { apiBaseUrl } = parseEnvironment({ VITE_API_BASE_URL: config.apiBaseUrl });
    if (
      typeof config.merchantCode !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(config.merchantCode)
    )
      throw new Error();
    // The registered callback may use a public origin different from the API
    // origin used by this browser. Its value must come from trusted public config.
    const returnUrl = config.returnUrl ?? `${apiBaseUrl}/api/v1/payment/vnpay-return`;
    const callback = new URL(returnUrl);
    if (
      returnUrl !== returnUrl.trim() ||
      /[\s\\?#]/.test(returnUrl) ||
      callback.username ||
      callback.password ||
      callback.pathname !== '/api/v1/payment/vnpay-return'
    )
      throw new Error();
    parseEnvironment({ VITE_API_BASE_URL: callback.origin });
    return Object.freeze({
      merchantCode: config.merchantCode,
      returnUrl,
    });
  } catch {
    // Never attach configuration values or signed URLs to an exception.
    throw new ApiError('client');
  }
}

function gatewayTime(local: string) {
  return local.slice(0, 19).replace(/[-:T]/g, '');
}

export function validatePaymentUrl(
  order: DepositOrder,
  policy: ReturnType<typeof createPaymentUrlPolicy>,
): void {
  if (!order.canContinuePayment) return;
  try {
    const value = order.paymentUrl;
    if (
      !value ||
      !order.paymentUrlExpiresAt ||
      /[\s\\#]/.test(value) ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !/^https:\/\/sandbox\.vnpayment\.vn(?::443)?\/paymentv2\/vpcpay\.html\?/.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'sandbox.vnpayment.vn' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== '/paymentv2/vpcpay.html'
    )
      throw new Error();
    const seen = new Set<string>();
    for (const [name] of url.searchParams) {
      if (seen.has(name)) throw new Error();
      seen.add(name);
    }
    const expected = {
      vnp_TxnRef: order.orderId,
      vnp_Amount: (BigInt(order.amount) * 100n).toString(),
      vnp_TmnCode: policy.merchantCode,
      vnp_ReturnUrl: policy.returnUrl,
      vnp_CurrCode: 'VND',
      vnp_Command: 'pay',
      vnp_Version: '2.1.0',
      vnp_CreateDate: gatewayTime(order.createdAt),
      vnp_ExpireDate: gatewayTime(order.paymentUrlExpiresAt),
    };
    for (const [name, expectedValue] of Object.entries(expected)) {
      if (url.searchParams.get(name) !== expectedValue) throw new Error();
    }
    if (!/^[0-9a-f]{128}$/i.test(url.searchParams.get('vnp_SecureHash') ?? '')) throw new Error();
    // This checks destination and correlation, not the HMAC or whether money was credited.
    // The backend alone knows the signing secret and committed payment state.
  } catch {
    throw new ApiError('protocol');
  }
}
