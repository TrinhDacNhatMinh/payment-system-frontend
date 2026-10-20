import { Link } from '@tanstack/react-router';
import { Typography } from 'antd';

import { RoutePlaceholder } from '@/shared/ui/route-placeholder';

export function SignInPage() {
  return (
    <RoutePlaceholder title="Sign in">
      <Typography.Paragraph>Sign in is not available yet.</Typography.Paragraph>
      <Link to="/register">Create account</Link>
    </RoutePlaceholder>
  );
}
