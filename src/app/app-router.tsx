import { RouterProvider } from '@tanstack/react-router';

import { useAuthSession } from '@/features/auth/model/session-context';
import { router } from './router';
import { useSessionRouteInvalidation } from './use-session-route-invalidation';

export function AppRouter() {
  const session = useAuthSession();
  useSessionRouteInvalidation(router);

  return (
    <RouterProvider
      router={router}
      context={{
        session: session?.controller ?? null,
        privateApi: session?.privateApi ?? null,
      }}
    />
  );
}
