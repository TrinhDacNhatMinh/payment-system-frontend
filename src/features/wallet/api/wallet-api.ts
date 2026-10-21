import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import { ApiError } from '@/shared/api/api-error';
import { walletResponseSchema } from './wallet-schemas';

export const MY_WALLET_PATH = '/api/v1/wallet/me';

export function createWalletApi(privateApi: PrivateApiFactory, access: SessionAccess) {
  const api = privateApi(access);
  return {
    async getMyWallet(signal?: AbortSignal) {
      const wallet = await api.request(
        { method: 'GET', path: MY_WALLET_PATH, signal },
        walletResponseSchema,
      );
      if (wallet.userId !== access.user.id) throw new ApiError('protocol');
      return wallet;
    },
  };
}
