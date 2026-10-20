import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';

export function WalletPage() {
  return (
    <>
      <PageHeading title="My wallet" description="Your VND balance and payment actions." />
      <ContentState
        kind="warning"
        title="Wallet is not available yet"
        description="Your balance and transactions will appear here when wallet access is available."
      />
    </>
  );
}
