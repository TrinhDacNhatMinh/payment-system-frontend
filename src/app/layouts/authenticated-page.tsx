import { getRouteApi, Outlet } from '@tanstack/react-router';

import { PrivateContent } from './private-content';

const route = getRouteApi('/_authenticated');

export function AuthenticatedPage() {
  const { access } = route.useRouteContext();
  return (
    <PrivateContent access={access}>
      <Outlet />
    </PrivateContent>
  );
}
