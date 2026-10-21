import { createBrowserSessionCoordination } from '@/features/auth/model/browser-session-coordination';
import { createPrivateApi } from '@/features/auth/api/private-api';
import {
  createSessionController,
  type SessionController,
} from '@/features/auth/model/session-controller';
import { createAppApiClients } from './api-clients';
import { queryClient } from './query-client';

export function createAppSession() {
  let controller: SessionController | null = null;
  const clients = createAppApiClients(() => controller?.getAccessToken() ?? null);
  controller = createSessionController({
    transport: clients.auth,
    coordination: createBrowserSessionCoordination(),
    clearPrivateData: () => {
      void queryClient.cancelQueries().catch(() => undefined);
      queryClient.clear();
    },
  });
  return { controller, privateApi: createPrivateApi(clients.business, controller) };
}
