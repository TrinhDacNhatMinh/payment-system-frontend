import { createFileRoute } from '@tanstack/react-router';

import { SignedOutPage } from '@/app/layouts/signed-out-page';
import { AuthenticatedPage } from '@/app/layouts/authenticated-page';
import { ProtectedRouteError } from '@/app/layouts/protected-route-error';
import { privateRouteContext } from '@/app/private-route';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, abortController, preload }) =>
    privateRouteContext(context, { signal: abortController.signal, preload }),
  staleTime: 0,
  gcTime: 0,
  shouldReload: true,
  pendingMs: 0,
  pendingMinMs: 0,
  component: AuthenticatedPage,
  pendingComponent: SignedOutPage,
  errorComponent: ProtectedRouteError,
});
