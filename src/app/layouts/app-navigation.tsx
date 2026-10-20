import {
  HistoryOutlined,
  PlusCircleOutlined,
  SendOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Link } from '@tanstack/react-router';

export function AppNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="app-navigation flex flex-col gap-2">
      <Link
        to="/wallet"
        preload={false}
        className="navigation-item"
        activeProps={{
          className: 'navigation-item navigation-item-active',
          'aria-current': 'page',
        }}
        onClick={onNavigate}
      >
        <WalletOutlined aria-hidden="true" /> Wallet
      </Link>
      {[
        { label: 'Transfer', icon: <SendOutlined /> },
        { label: 'Top up', icon: <PlusCircleOutlined /> },
        { label: 'Transactions', icon: <HistoryOutlined /> },
      ].map(({ label, icon }) => (
        <button
          key={label}
          className="navigation-item navigation-item-unavailable"
          type="button"
          disabled
          title={`${label} is not available yet`}
        >
          <span aria-hidden="true">{icon}</span>
          <span>
            {label}
            <span className="navigation-note">Coming later</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
