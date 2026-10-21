import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api/api-error';
import { AuthRequestError } from '../api/auth-api';
import { getAuthFormFeedback } from './auth-form-feedback';

describe('session cleanup form feedback', () => {
  it('allows an explicit cleanup retry when login credentials have not been submitted', () => {
    const error = new AuthRequestError(new ApiError('timeout'), 'logout', 'submit');
    expect(getAuthFormFeedback(error, 'login')).toMatchObject({
      type: 'warning',
      title: 'Session cleanup not confirmed',
      uncertain: false,
    });
  });

  it('still requires sign-in review after an uncertain login POST', () => {
    const error = new AuthRequestError(new ApiError('timeout'), 'login', 'submit');
    expect(getAuthFormFeedback(error, 'login')).toMatchObject({
      type: 'warning',
      title: 'Sign-in outcome unknown',
      uncertain: true,
    });
  });
});
