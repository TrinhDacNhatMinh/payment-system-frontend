import { useEffect } from 'react';
import type { AnyRouter } from '@tanstack/react-router';

import { useAuthSession } from '@/features/auth/model/session-context';

export function useSessionRouteInvalidation(router: AnyRouter) {
  const session = useAuthSession();
  const state = session?.state;
  const accessKey =
    state?.status === 'authenticated'
      ? `${state.epoch}:${state.user.id}:${state.user.role}`
      : 'unverified';
  useEffect(() => {
    // Keep sign-in mounted while credentials are being submitted. Revalidate
    // when the verified identity changes, not at every intermediate auth state.
    router.clearCache();
    void router.invalidate({ sync: true });
  }, [router, accessKey]);
}
