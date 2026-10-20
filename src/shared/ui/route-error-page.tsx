import { Typography } from 'antd';

import { RoutePlaceholder } from './route-placeholder';

export function RouteErrorPage() {
  return (
    <RoutePlaceholder title="Something went wrong">
      <Typography.Paragraph>Please reload the page to try again.</Typography.Paragraph>
    </RoutePlaceholder>
  );
}
