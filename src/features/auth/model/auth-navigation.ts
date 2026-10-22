import '@tanstack/react-router';

import { paymentOrderIdSchema } from '@/shared/api/payment-order-id';

declare module '@tanstack/react-router' {
  interface HistoryState {
    authReturnTo?: unknown;
  }
}

type AuthReturnTo = '/wallet' | '/transfer' | '/deposit' | `/payment/result?orderId=${string}`;

// Only the payment result's validated order ID may cross the auth boundary.
// No raw gateway query, status, signed URL, token or business draft is forwarded.
export function getAuthReturnTo(value: unknown): AuthReturnTo | undefined {
  if (value === '/wallet' || value === '/transfer' || value === '/deposit') return value;
  if (typeof value !== 'string' || !value.startsWith('/payment/result?') || value.includes('#'))
    return undefined;
  const query = new URLSearchParams(value.slice('/payment/result?'.length));
  if ([...query.keys()].length !== 1 || !query.has('orderId')) return undefined;
  const id = paymentOrderIdSchema.safeParse(query.get('orderId'));
  return id.success ? `/payment/result?orderId=${encodeURIComponent(id.data)}` : undefined;
}

export function getAuthNavigationTarget(
  value: unknown,
  fallback: '/wallet' | '/login' = '/wallet',
) {
  const target = getAuthReturnTo(value);
  if (target === '/wallet' || target === '/transfer' || target === '/deposit')
    return { to: target };
  if (target) {
    const orderId = new URLSearchParams(target.slice('/payment/result?'.length)).get('orderId');
    // getAuthReturnTo has already checked this value, without trusting history state.
    if (orderId) return { to: '/payment/result' as const, search: { orderId } };
  }
  return { to: fallback };
}
