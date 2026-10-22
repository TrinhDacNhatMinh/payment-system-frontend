import { describe, expect, it, vi } from 'vitest';

import { makeDepositOrder, makeVnpayReturnFragment } from './deposit-fixture.test-support';
import { forwardVnpayReturn, getVnpayReturnQuery } from './vnpay-return-relay';

const origin = 'http://localhost:8080';
const id = makeDepositOrder().orderId;

describe('frontend forwarding of a signed VNPay return', () => {
  it('preserves signed parameter values and forwards only to the fixed webhook without credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ RspCode: '00', Message: 'Confirm Success' })),
      );
    vi.stubGlobal('fetch', request);
    const fragment = makeVnpayReturnFragment();
    await forwardVnpayReturn(origin, id, fragment);
    const call = request.mock.calls[0];
    const target = new URL(String(call?.[0]));
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe('/api/v1/payment/vnpay-webhook');
    expect(target.searchParams.get('vnp_OrderInfo')).toBe('Top up + coffee & lunch');
    expect(target.searchParams.get('vnp_SecureHash')).toBe('a'.repeat(128));
    expect(call?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(call?.[1]?.headers).toEqual({ Accept: 'application/json' });
  });

  it('shares an in-flight callback between concurrent mounts', async () => {
    let resolve: (reply: Response) => void = () => undefined;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', request);
    const first = forwardVnpayReturn(origin, id, makeVnpayReturnFragment());
    const second = forwardVnpayReturn(origin, id, makeVnpayReturnFragment());
    expect(first).toBe(second);
    resolve(new Response(JSON.stringify({ RspCode: '02', Message: 'Order already confirmed' })));
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(['97', '99', '01', '04'])(
    'does not treat callback rejection %s as payment success',
    async (code) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ RspCode: code, Message: 'Rejected' })));
      vi.stubGlobal('fetch', request);
      await expect(forwardVnpayReturn(origin, id, makeVnpayReturnFragment())).rejects.toMatchObject(
        { kind: 'protocol' },
      );
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it('permits explicit retry after network failure, without retaining a successful result or retrying automatically', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ RspCode: '02', Message: 'Already confirmed' })),
      );
    vi.stubGlobal('fetch', request);
    await expect(forwardVnpayReturn(origin, id, makeVnpayReturnFragment())).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
    await forwardVnpayReturn(origin, id, makeVnpayReturnFragment());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects missing, duplicate, mismatched and unsigned callback data before sending anything', () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', request);
    const query = getVnpayReturnQuery(makeVnpayReturnFragment(), id);
    const invalid = [
      '',
      'other=value',
      makeVnpayReturnFragment() + '&vnpayReturn=duplicate',
      `vnpayReturn=${encodeURIComponent(query + '&vnp_Amount=1')}`,
      `vnpayReturn=${encodeURIComponent(query.replace('vnp_SecureHash=', 'unsigned='))}`,
    ];
    for (const fragment of invalid) {
      expect(() => forwardVnpayReturn(origin, id, fragment)).toThrow();
    }
    expect(() => forwardVnpayReturn(origin, 'OTHER_ORDER', makeVnpayReturnFragment())).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
