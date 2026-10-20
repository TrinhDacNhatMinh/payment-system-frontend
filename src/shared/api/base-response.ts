import { z } from 'zod';

import { ApiError } from './api-error';

const timestampSchema = z.string().datetime({ offset: true });
const envelopeSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z.unknown().optional(),
    error: z.null().optional(),
    timestamp: timestampSchema,
  }),
  z.object({
    success: z.literal(false),
    data: z.null().optional(),
    error: z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
      message: z.string(),
    }),
    timestamp: timestampSchema,
  }),
]);

export const emptyResponseSchema = z.union([z.undefined(), z.null()]).transform(() => undefined);

export function parseBaseResponse<T>(body: unknown, status: number, schema: z.ZodType<T>): T {
  const isSuccessStatus = status >= 200 && status < 300;
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new ApiError(isSuccessStatus ? 'protocol' : 'http', { status });
  }
  if (!envelope.data.success) {
    throw new ApiError('business', { status, code: envelope.data.error.code });
  }
  if (!isSuccessStatus) throw new ApiError('http', { status });
  const data = schema.safeParse(envelope.data.data);
  if (!data.success) throw new ApiError('protocol', { status });
  return data.data;
}
