import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { NotFoundPage } from '@/shared/ui/not-found-page';
import { RouteErrorPage } from '@/shared/ui/route-error-page';
import type { AppRouterContext } from '@/app/router-context';

export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});
