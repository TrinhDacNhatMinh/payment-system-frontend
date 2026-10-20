import { z } from 'zod';

import { CSRF_HEADER_NAME } from '@/shared/api/http-client';

const idSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const roleSchema = z.enum(['USER', 'ADMIN']);

export const csrfResponseSchema = z.object({
  headerName: z.literal(CSRF_HEADER_NAME),
  token: z.string().min(1),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  user: z.object({ id: idSchema, email: z.string().email(), role: roleSchema }),
});

export const registeredUserSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  fullName: z.string(),
  role: roleSchema,
  status: z.enum(['ACTIVE', 'LOCKED']),
});

export type AuthSession = z.infer<typeof sessionResponseSchema>;
export type RegisteredUser = z.infer<typeof registeredUserSchema>;
export type LoginRequest = { email: string; password: string };
export type RegisterRequest = LoginRequest & { fullName: string; phone: string };
