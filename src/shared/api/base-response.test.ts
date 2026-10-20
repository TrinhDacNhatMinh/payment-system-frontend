import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorReply, successReply } from '@/test/api-adapter';
import { emptyResponseSchema, parseBaseResponse } from './base-response';

describe('BaseResponse boundary', () => {
  it('validates and unwraps data, excluding undeclared response fields', () => {
    const reply = successReply({ id: 1, cookie: 'not-public' });
    expect(parseBaseResponse(reply.data, 201, z.object({ id: z.number() }))).toEqual({ id: 1 });
  });

  it.each([undefined, null])('accepts logout without a data value', (data) => {
    const body = {
      success: true,
      timestamp: '2026-10-20T12:00:00Z',
      ...(data === null ? { data } : {}),
    };
    expect(parseBaseResponse(body, 200, emptyResponseSchema)).toBeUndefined();
  });

  it('retains a business code/status without exposing the server message', () => {
    const reply = errorReply('INVALID_CREDENTIALS', 401);
    expect(() => parseBaseResponse(reply.data, 401, z.unknown())).toThrow(
      'Email or password is incorrect.',
    );
  });

  it.each([
    { success: true, data: { id: 'wrong-type' }, timestamp: '2026-10-20T12:00:00Z' },
    { success: true, data: { id: 1 } },
    { success: true, data: { id: 1 }, error: { code: 'ERROR' }, timestamp: '2026-10-20T12:00:00Z' },
    '<html>not JSON</html>',
  ])('rejects malformed envelopes or data instead of treating them as success', (body) => {
    expect(() => parseBaseResponse(body, 200, z.object({ id: z.number() }))).toThrow(
      'The server returned an unexpected response.',
    );
  });

  it('does not accept success:true on an HTTP error', () => {
    expect(() =>
      parseBaseResponse(
        { success: true, data: 'ok', timestamp: '2026-10-20T12:00:00Z' },
        500,
        z.string(),
      ),
    ).toThrow('The server could not complete the request.');
  });

  it('does not expose an unknown business code as user-facing text', () => {
    const reply = errorReply('UNRECOGNIZED_ERROR', 400);
    expect(() => parseBaseResponse(reply.data, 400, z.unknown())).toThrow(
      'The request could not be completed.',
    );
  });
});
