import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Alert } from 'antd';

import { AuthLayout } from '@/app/layouts/auth-layout';
import { ContentState } from '@/shared/ui/content-state';
import { useAuthFormActions } from '../model/auth-form-actions';
import { getAuthReturnTo } from '../model/auth-navigation';
import { useAuthSession } from '../model/session-context';
import { AuthForm } from '../ui/auth-form';
import { SessionNotice } from '../ui/session-notice';

export function SignInPage({ embedded = false }: { embedded?: boolean }) {
  const actions = useAuthFormActions();
  const session = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = getAuthReturnTo(embedded ? location.pathname : location.state.authReturnTo);
  const controller = session?.controller;
  const status = session?.state.status;

  useEffect(() => {
    if (
      !embedded &&
      location.pathname === '/login' &&
      status === 'authenticated' &&
      controller?.getAccessIdentity()
    ) {
      void navigate({ to: returnTo ?? '/wallet', replace: true });
    }
  }, [embedded, location.pathname, status, controller, returnTo, navigate]);

  if (
    !embedded &&
    (session?.state.status === 'restoring' || session?.state.status === 'authenticated')
  ) {
    return (
      <AuthLayout title="Sign in" description="Access your wallet and transactions.">
        <ContentState kind="loading" title="Restoring your session…" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Access your wallet and transactions."
      embedded={embedded}
      footer={
        <>
          Don’t have an account?{' '}
          <Link to="/register" state={{ authReturnTo: returnTo }}>
            Create account
          </Link>
        </>
      }
    >
      {embedded && <Alert type="info" showIcon title="Sign in to continue on this page." />}
      {!embedded && <SessionNotice />}
      <AuthForm
        mode="login"
        submit={
          actions
            ? (values, signal) =>
                actions.login({ email: values.email, password: values.password }, signal)
            : undefined
        }
        onSuccess={() => {
          if (!embedded && !session) void navigate({ to: returnTo ?? '/wallet', replace: true });
        }}
      />
    </AuthLayout>
  );
}
