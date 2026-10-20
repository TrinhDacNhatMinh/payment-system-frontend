import axios from 'axios';

export type ApiErrorKind =
  'business' | 'http' | 'network' | 'timeout' | 'cancelled' | 'protocol' | 'client';

const kindMessages: Record<ApiErrorKind, string> = {
  business: 'The request could not be completed.',
  http: 'The server could not complete the request.',
  network: 'Unable to reach the server. Check your connection.',
  timeout: 'The request timed out. Its outcome may be unknown.',
  cancelled: 'The request was cancelled. Its outcome may be unknown.',
  protocol: 'The server returned an unexpected response.',
  client: 'The request could not be prepared.',
};

const codeMessages: Record<string, string> = {
  VALIDATION_ERROR: 'Check the information you entered.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  ACCOUNT_LOCKED: 'Your account is locked. You cannot access your wallet at this time.',
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  ORIGIN_NOT_ALLOWED: 'This application is not allowed to connect to the server.',
  CSRF_TOKEN_MISSING: 'Unable to verify the request. Please try again.',
  CSRF_TOKEN_INVALID: 'Unable to verify the request. Please try again.',
  AUTH_SESSION_BUSY: 'Your session is busy. Please try again.',
  TOKEN_EXPIRED: 'Your session needs to be renewed.',
  TOKEN_INVALID: 'Please sign in again to continue.',
  UNAUTHORIZED: 'Please sign in to continue.',
  REFRESH_TOKEN_MISSING: 'Please sign in to continue.',
  REFRESH_TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  REFRESH_TOKEN_REVOKED: 'Please sign in again to continue.',
  REFRESH_TOKEN_NOT_FOUND: 'Please sign in again to continue.',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ApiErrorKind, options: { status?: number; code?: string } = {}) {
    const message =
      kind === 'business' && options.code && Object.hasOwn(codeMessages, options.code)
        ? codeMessages[options.code]
        : kindMessages[kind];
    super(message ?? kindMessages[kind]);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
  }
}

// Never retain Axios config/request/response or raw server messages: they can
// contain passwords, bearer tokens, CSRF tokens or sensitive response bodies.
export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error)) return new ApiError('cancelled');
  if (!axios.isAxiosError(error)) return new ApiError('client');
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ApiError('timeout');
  }
  if (error.code === 'ERR_BAD_RESPONSE') return new ApiError('protocol');
  return new ApiError('network');
}
