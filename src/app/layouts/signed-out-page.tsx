import { SignInPage } from '@/features/auth/pages/sign-in-page';
import { AppLayout } from './app-layout';

export function SignedOutPage() {
  return (
    <AppLayout>
      <SignInPage embedded />
    </AppLayout>
  );
}
