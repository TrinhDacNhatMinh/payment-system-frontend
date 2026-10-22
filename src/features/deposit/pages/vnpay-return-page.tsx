import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from 'antd';

import { AppLayout } from '@/app/layouts/app-layout';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { forwardVnpayReturn } from '../api/vnpay-return-relay';

export function VnpayReturnPage({ orderId, fragment }: { orderId: string; fragment: string }) {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    async function forward() {
      try {
        await forwardVnpayReturn(import.meta.env.VITE_API_BASE_URL, orderId, fragment);
        if (mounted)
          await navigate({
            to: '/payment/result',
            search: { orderId },
            hash: '',
            replace: true,
          });
      } catch {
        if (mounted) setFailed(true);
      }
    }
    void forward();
    // A submitted callback may already be committed; the backend handles repeats atomically.
    return () => {
      mounted = false;
    };
  }, [attempt, fragment, navigate, orderId]);
  return (
    <AppLayout>
      <div className="wallet-panel wallet-stack">
        <PageHeading title="Top-up result" />
        {failed ? (
          <>
            <ContentState
              kind="warning"
              title="Payment confirmation unavailable"
              description="Your payment result has not been confirmed. Try confirming again or check its status."
            />
            <Button
              htmlType="button"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              Retry confirmation
            </Button>
            <Link to="/payment/result" search={{ orderId }} hash="" replace preload={false}>
              Check payment status
            </Link>
          </>
        ) : (
          <ContentState kind="loading" title="Confirming your payment…" />
        )}
      </div>
    </AppLayout>
  );
}
