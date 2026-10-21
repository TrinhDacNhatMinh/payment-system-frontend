import { SignInPage } from '@/features/auth/pages/sign-in-page';
import { useAuthSession } from '@/features/auth/model/session-context';
import { ContentState } from '@/shared/ui/content-state';
import { AppLayout } from './app-layout';

export function SignedOutPage() {
  const session = useAuthSession();
  const state = session?.state;
  if (state?.status === 'restoring') {
    return (
      <AppLayout>
        <ContentState
          kind="loading"
          title="Restoring your session…"
          description="Please wait while we check your session."
        />
      </AppLayout>
    );
  }
  if (state?.status === 'authenticated') {
    // I1-08 will replace this session summary with the guarded private Outlet.
    return (
      <AppLayout>
        <ContentState
          kind="empty"
          title="Signed in"
          description={`${state.user.email} — Your session is active. Wallet access is not available yet.`}
        />
      </AppLayout>
    );
  }
  return (
    <AppLayout>
      {state?.status === 'connection-error' && (
        <ContentState
          kind="error"
          title="Unable to check your session"
          description={state.message}
          onRetry={() => {
            void session?.controller.restore();
          }}
        />
      )}
      {state?.status === 'unsupported' && (
        <ContentState kind="warning" title="Session unavailable" description={state.message} />
      )}
      {state?.status === 'locked' && (
        <ContentState kind="error" title="Account unavailable" description={state.message} />
      )}
      {(state?.status === 'refresh-uncertain' || state?.status === 'logout-pending') && (
        <ContentState kind="warning" title="Sign in again" description={state.message} />
      )}
      <SignInPage embedded />
    </AppLayout>
  );
}
