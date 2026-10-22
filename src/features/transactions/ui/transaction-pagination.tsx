import { Pagination } from 'antd';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { TRANSACTIONS_PAGE_SIZE } from '../model/transaction-search';

export function TransactionPagination({
  page,
  total,
  busy,
  change,
}: {
  page: number;
  total: number;
  busy: boolean;
  change: (page: number) => Promise<void>;
}) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  return (
    <nav aria-label="Transaction pagination" className="transaction-pagination">
      <Pagination
        current={page}
        pageSize={TRANSACTIONS_PAGE_SIZE}
        total={total}
        simple={isMobile}
        showLessItems
        showSizeChanger={false}
        disabled={busy}
        onChange={(next) => {
          if (Number.isInteger(next) && next >= 1 && next <= Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE))) {
            void change(next);
          }
        }}
      />
    </nav>
  );
}
