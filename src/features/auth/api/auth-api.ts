import type { z } from 'zod';

import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import { emptyResponseSchema } from '@/shared/api/base-response';
import type { ApiTransport } from '@/shared/api/http-client';
import {
  csrfResponseSchema,
  registeredUserSchema,
  sessionResponseSchema,
  type LoginRequest,
  type RegisterRequest,
} from './auth-schemas';

type AuthOperation = 'register' | 'login' | 'refresh' | 'logout';
type AuthPhase = 'lock' | 'csrf' | 'submit';

// The I1-07 session controller supplies the cross-tab Web Lock and epoch check.
// It must not already hold the same lock when invoking these operations.
export type WithAuthLock = <T>(operation: () => Promise<T>) => Promise<T>;

export class AuthRequestError extends ApiError {
  readonly operation: AuthOperation;
  readonly phase: AuthPhase;

  constructor(error: ApiError, operation: AuthOperation, phase: AuthPhase) {
    super(error.kind, { status: error.status, code: error.code });
    this.name = 'AuthRequestError';
    this.operation = operation;
    this.phase = phase;
  }
}

export function createAuthApi(transport: ApiTransport, withAuthLock: WithAuthLock) {
  async function execute<T>(
    operation: AuthOperation,
    data: unknown,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await withAuthLock(async () => {
        // The token belongs only to this operation; never cache/persist it.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let csrf: z.infer<typeof csrfResponseSchema>;
          try {
            csrf = await transport.request(
              { method: 'GET', path: '/api/v1/auth/csrf', signal },
              csrfResponseSchema,
            );
          } catch (error) {
            throw new AuthRequestError(normalizeApiError(error), operation, 'csrf');
          }
          try {
            return await transport.request(
              {
                method: 'POST',
                path: `/api/v1/auth/${operation}`,
                data,
                csrfToken: csrf.token,
                signal,
              },
              schema,
            );
          } catch (error) {
            const failure = normalizeApiError(error);
            const rejectedCsrf =
              failure.kind === 'business' &&
              failure.status === 403 &&
              (failure.code === 'CSRF_TOKEN_MISSING' || failure.code === 'CSRF_TOKEN_INVALID');
            if (attempt === 0 && rejectedCsrf) continue;
            throw new AuthRequestError(failure, operation, 'submit');
          }
        }
        throw new ApiError('client');
      });
    } catch (error) {
      if (error instanceof AuthRequestError) throw error;
      throw new AuthRequestError(normalizeApiError(error), operation, 'lock');
    }
  }

  return {
    register: ({ email, password, fullName, phone }: RegisterRequest, signal?: AbortSignal) =>
      execute('register', { email, password, fullName, phone }, registeredUserSchema, signal),
    login: ({ email, password }: LoginRequest, signal?: AbortSignal) =>
      execute('login', { email, password }, sessionResponseSchema, signal),
    refresh: (signal?: AbortSignal) => execute('refresh', {}, sessionResponseSchema, signal),
    logout: (signal?: AbortSignal) => execute('logout', {}, emptyResponseSchema, signal),
  };
}
