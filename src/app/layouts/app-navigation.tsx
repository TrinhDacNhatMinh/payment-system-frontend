import { PlusCircleOutlined, SwapOutlined, WalletOutlined } from '@ant-design/icons';
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
      <Link
        to="/transfer"
        preload={false}
        className="navigation-item"
        activeProps={{
          className: 'navigation-item navigation-item-active',
          'aria-current': 'page',
        }}
        onClick={onNavigate}
      >
        <SwapOutlined aria-hidden="true" /> Transfer
      </Link>
      <Link
        to="/deposit"
        preload={false}
        className="navigation-item"
        activeProps={{
          className: 'navigation-item navigation-item-active',
          'aria-current': 'page',
        }}
        onClick={onNavigate}
      >
        <PlusCircleOutlined aria-hidden="true" /> Top up
      </Link>
    </nav>
  );
}
