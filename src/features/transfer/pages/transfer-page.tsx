import { useAuthSession } from '@/features/auth/model/session-context';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { TransferFlow } from '../ui/transfer-flow';

export function TransferPage() {
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  if (!access || !session?.privateApi)
    return <ContentState kind="loading" title="Checking your session…" />;
  return (
    <div className="transfer-panel">
      <PageHeading title="Transfer" />
      <TransferFlow
        key={`${access.epoch}:${access.user.id}:${access.user.role}`}
        session={session.controller}
        access={access}
        privateApi={session.privateApi}
      />
    </div>
  );
}
