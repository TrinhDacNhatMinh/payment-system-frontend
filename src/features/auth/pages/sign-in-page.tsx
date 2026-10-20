import { Link } from '@tanstack/react-router';
import { Alert } from 'antd';

import { AuthLayout } from '@/app/layouts/auth-layout';

export function SignInPage({ embedded = false }: { embedded?: boolean }) {
  return (
    <AuthLayout
      title="Sign in"
      description="Access your wallet and transactions."
      embedded={embedded}
      footer={
        <>
          Don’t have an account? <Link to="/register">Create account</Link>
        </>
      }
    >
      {embedded && <Alert type="info" showIcon title="Sign in to continue on this page." />}
      <Alert type="warning" showIcon title="Sign in is not available yet." />
    </AuthLayout>
  );
}
