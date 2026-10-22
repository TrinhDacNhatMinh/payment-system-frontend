import { z } from 'zod';

import { ApiError } from '@/shared/api/api-error';
import { parseEnvironment } from '@/shared/config/env-schema';

const pending = new Map<string, Promise<void>>();
const replySchema = z.object({ RspCode: z.string(), Message: z.string() });
const MAX_CALLBACK_LENGTH = 16_384;

export function getVnpayReturnQuery(fragment: string, orderId: string): string {
  if (fragment.length > MAX_CALLBACK_LENGTH * 3 + 32) throw new ApiError('client');
  const wrapper = new URLSearchParams(fragment.replace(/^#/, ''));
  const entries = [...wrapper.entries()];
  const entry = entries[0];
  if (entries.length !== 1 || !entry || entry[0] !== 'vnpayReturn') throw new ApiError('client');
  const query = entry[1];
  if (!query || query.length > MAX_CALLBACK_LENGTH || /[#\r\n]/.test(query))
    throw new ApiError('client');
  const values = new URLSearchParams(query);
  const names = new Set<string>();
  for (const [name] of values) {
    if (!/^vnp_[A-Za-z0-9]+$/.test(name) || names.has(name)) throw new ApiError('client');
    names.add(name);
  }
  if (
    values.get('vnp_TxnRef') !== orderId ||
    !/^[0-9]{1,18}$/.test(values.get('vnp_Amount') ?? '') ||
    !/^[0-9]{2}$/.test(values.get('vnp_ResponseCode') ?? '') ||
    !/^[0-9]{2}$/.test(values.get('vnp_TransactionStatus') ?? '') ||
    !/^[0-9]{1,15}$/.test(values.get('vnp_TransactionNo') ?? '') ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(values.get('vnp_TmnCode') ?? '') ||
    !/^[0-9a-f]{128}$/i.test(values.get('vnp_SecureHash') ?? '')
  )
    throw new ApiError('client');
  return query;
}

// Public, signed callback: no session token/cookie, no stored payload, no automatic retry.
export function forwardVnpayReturn(apiOrigin: string, orderId: string, fragment: string) {
  const { apiBaseUrl } = parseEnvironment({ VITE_API_BASE_URL: apiOrigin });
  const query = getVnpayReturnQuery(fragment, orderId);
  const key = `${apiBaseUrl}|${orderId}|${query}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const response = await fetch(`${apiBaseUrl}/api/v1/payment/vnpay-webhook?${query}`, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new ApiError('http', { status: response.status });
    const result = replySchema.safeParse(await response.json());
    if (!result.success || !['00', '02'].includes(result.data.RspCode))
      throw new ApiError('protocol');
  })();
  pending.set(key, work);
  void work.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  return work;
}
