import { WalletOutlined } from '@ant-design/icons';
import { Link } from '@tanstack/react-router';

export function Brand() {
  return (
    <Link to="/wallet" className="brand" aria-label="Payment System home" preload={false}>
      <span className="brand-icon" aria-hidden="true">
        <WalletOutlined />
      </span>
      <span>Payment System</span>
    </Link>
  );
}
