import { Card, Table, Tag, type TableProps } from 'antd';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import type { TransactionResponse } from '../api/transaction-schemas';
import { transactionDisplay, type TransactionDisplay } from '../model/transaction-display';

const STATUS_COLORS = { SUCCESS: 'success', PENDING: 'processing', FAILED: 'error' } as const;

function Status({ item }: { item: TransactionDisplay }) {
  return <Tag color={STATUS_COLORS[item.status]}>{item.statusLabel}</Tag>;
}

function Amount({ item }: { item: TransactionDisplay }) {
  return (
    <span
      className={`transaction-amount transaction-amount-${item.direction}`}
      aria-label={item.amountLabel}
    >
      {item.amount}
    </span>
  );
}

const columns: TableProps<TransactionDisplay>['columns'] = [
  { title: 'Type', dataIndex: 'type', key: 'type', width: 170 },
  {
    title: 'Amount',
    key: 'amount',
    align: 'right',
    width: 220,
    render: (item: TransactionDisplay) => <Amount item={item} />,
  },
  {
    title: 'Status',
    key: 'status',
    width: 130,
    render: (item: TransactionDisplay) => <Status item={item} />,
  },
  {
    title: 'Description',
    dataIndex: 'description',
    key: 'description',
    render: (description: string | null) =>
      description === null ? (
        <span aria-label="No description">—</span>
      ) : (
        <span className="transaction-description">{description}</span>
      ),
  },
  {
    title: 'Date',
    key: 'time',
    width: 180,
    render: (item: TransactionDisplay) => <time dateTime={item.createdAt}>{item.time}</time>,
  },
];

export function TransactionHistory({ transactions }: { transactions: TransactionResponse[] }) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const items = transactions.map(transactionDisplay);
  if (isMobile) {
    return (
      <ul className="transaction-list" aria-label="Transactions">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <div className="transaction-card-heading">
                <h2>{item.type}</h2>
                <Status item={item} />
              </div>
              <p className="transaction-card-amount">
                <Amount item={item} />
              </p>
              {item.description !== null && (
                <p className="transaction-description">{item.description}</p>
              )}
              <time className="transaction-time" dateTime={item.createdAt}>
                {item.time}
              </time>
            </Card>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="transaction-table" role="region" aria-label="Transactions table" tabIndex={0}>
      <Table<TransactionDisplay>
        rowKey="id"
        columns={columns}
        dataSource={items}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: 950 }}
      />
    </div>
  );
}
