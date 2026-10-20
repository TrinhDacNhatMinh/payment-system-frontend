import { Link } from '@tanstack/react-router';
import { Alert } from 'antd';

import { AuthLayout } from '@/app/layouts/auth-layout';

export function RegisterPage() {
  return (
    <AuthLayout
      title="Create account"
      description="Create your account to start using your VND wallet."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <Alert type="warning" showIcon title="Registration is not available yet." />
    </AuthLayout>
  );
}
