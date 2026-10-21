import type { QueryClient } from '@tanstack/react-query';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionController } from '@/features/auth/model/session-controller';

export interface AppRouterContext {
  queryClient: QueryClient;
  session: SessionController | null;
  privateApi: PrivateApiFactory | null;
}
