import { Link } from '@tanstack/react-router';
import { Typography } from 'antd';

import { RoutePlaceholder } from './route-placeholder';

export function NotFoundPage() {
  return (
    <RoutePlaceholder title="Page not found">
      <Typography.Paragraph>The page you requested could not be found.</Typography.Paragraph>
      <Link to="/wallet">Go to wallet</Link>
    </RoutePlaceholder>
  );
}
