import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import { AuthRequestError } from '../api/auth-api';

export function getAuthFormFeedback(error: unknown, mode: 'login' | 'register') {
  const failure = normalizeApiError(error);
  if (mode === 'login' && error instanceof AuthRequestError && error.operation === 'logout') {
    return {
      type: 'warning' as const,
      title: 'Session cleanup not confirmed',
      description: 'Sign in again to retry session cleanup before starting a new sign-in.',
      uncertain: false,
    };
  }
  const beforeSubmit = error instanceof AuthRequestError && error.phase !== 'submit';
  const uncertain =
    !beforeSubmit &&
    (['network', 'timeout', 'cancelled', 'protocol', 'http'].includes(failure.kind) ||
      (failure.status !== undefined && failure.status >= 500) ||
      !(error instanceof ApiError));

  if (uncertain) {
    return {
      type: 'warning' as const,
      title: mode === 'register' ? 'Registration outcome unknown' : 'Sign-in outcome unknown',
      description:
        mode === 'register'
          ? 'We could not confirm whether your account was created. Try signing in before creating another account.'
          : 'We could not confirm sign-in. Review your sign-in before starting another attempt.',
      uncertain: true,
    };
  }

  return {
    type: 'error' as const,
    title: failure.message,
    description: beforeSubmit
      ? 'The authentication request was not submitted. Please try again.'
      : undefined,
    uncertain: false,
  };
}
