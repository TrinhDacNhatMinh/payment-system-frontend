import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Alert } from 'antd';

import { AuthLayout } from '@/app/layouts/auth-layout';
import { useAuthFormActions } from '../model/auth-form-actions';
import { getAuthNavigationTarget, getAuthReturnTo } from '../model/auth-navigation';
import { AuthForm } from '../ui/auth-form';
import { SessionNotice } from '../ui/session-notice';

export function RegisterPage() {
  const actions = useAuthFormActions();
  const location = useLocation();
  const returnTo = getAuthReturnTo(location.state.authReturnTo);
  const signInTarget = getAuthNavigationTarget(returnTo, '/login');
  const [created, setCreated] = useState(false);

  if (created) {
    return (
      <AuthLayout
        title="Account created"
        description="Your account is ready. Sign in to access your wallet."
      >
        <Alert type="success" role="status" showIcon title="Account created successfully." />
        <Link {...signInTarget} preload={false} className="auth-primary-link">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      description="Create your account to start."
      footer={
        <>
          Already have an account?{' '}
          <Link {...signInTarget} preload={false}>
            Sign in
          </Link>
        </>
      }
    >
      <SessionNotice />
      <AuthForm
        mode="register"
        submit={
          actions
            ? async (values, signal) => {
                await actions.register(values, signal);
              }
            : undefined
        }
        onSuccess={() => setCreated(true)}
      />
    </AuthLayout>
  );
}
