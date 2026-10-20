import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Alert } from 'antd';

import { AuthLayout } from '@/app/layouts/auth-layout';
import { useAuthFormActions } from '../model/auth-form-actions';
import { getAuthReturnTo } from '../model/auth-navigation';
import { AuthForm } from '../ui/auth-form';

export function SignInPage({ embedded = false }: { embedded?: boolean }) {
  const actions = useAuthFormActions();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = getAuthReturnTo(embedded ? location.pathname : location.state.authReturnTo);

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
      <AuthForm
        mode="login"
        submit={
          actions
            ? (values, signal) =>
                actions.login({ email: values.email, password: values.password }, signal)
            : undefined
        }
        onSuccess={() => {
          if (!embedded) void navigate({ to: returnTo ?? '/wallet', replace: true });
        }}
      />
    </AuthLayout>
  );
}
