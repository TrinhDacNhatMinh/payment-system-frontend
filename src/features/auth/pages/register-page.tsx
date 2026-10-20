import { Link } from '@tanstack/react-router';
import { Typography } from 'antd';

import { RoutePlaceholder } from '@/shared/ui/route-placeholder';

export function RegisterPage() {
  return (
    <RoutePlaceholder title="Create account">
      <Typography.Paragraph>Registration is not available yet.</Typography.Paragraph>
      <Link to="/login">Back to sign in</Link>
    </RoutePlaceholder>
  );
}
