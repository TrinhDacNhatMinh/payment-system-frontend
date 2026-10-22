import { parseEnvironment } from '@/shared/config/env-schema';
import { createPaymentUrlPolicy, type DepositGatewayConfig } from '../api/payment-url';

// Missing/invalid gateway configuration disables payment without breaking other routes.
export function parseDepositGatewayConfig(
  values: Record<string, unknown>,
): DepositGatewayConfig | null {
  try {
    const { apiBaseUrl } = parseEnvironment(values);
    const merchantCode = values.VITE_VNPAY_TMN_CODE;
    const returnUrl = values.VITE_VNPAY_RETURN_URL;
    if (typeof merchantCode !== 'string') return null;
    if (returnUrl !== undefined && typeof returnUrl !== 'string') return null;
    const config = { apiBaseUrl, merchantCode, returnUrl: returnUrl || undefined };
    createPaymentUrlPolicy(config);
    return config;
  } catch {
    return null;
  }
}
