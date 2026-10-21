import type { AxiosAdapter } from 'axios';
import { vi } from 'vitest';

import { createPrivateApi } from '@/features/auth/api/private-api';
import type { AuthSession } from '@/features/auth/api/auth-schemas';
import type { ControlRead } from '@/features/auth/model/session-control';
import {
  createSessionController,
  type SessionController,
} from '@/features/auth/model/session-controller';
import { createHttpClients } from '@/shared/api/http-client';
import { createApiAdapter, successReply, type ApiReply } from './api-adapter';
import { createSessionCoordinationHub } from './session-coordination';

export const testSession: AuthSession = {
  accessToken: 'test-access',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: { id: 1, email: 'member@example.com', role: 'USER' },
};
export const csrfReply = () => successReply({ headerName: 'X-XSRF-TOKEN', token: 'test-csrf' });

export function createSessionFixture(
  replies: ApiReply[],
  options: {
    initial?: ControlRead;
    adapter?: AxiosAdapter;
    clearPrivateData?: () => void;
  } = {},
) {
  const hub = createSessionCoordinationHub(
    options.initial === undefined
      ? {
          version: 1,
          epoch: '10000000-0000-4000-8000-000000000001',
          mode: 'active',
        }
      : options.initial,
  );
  const adapter = createApiAdapter(replies);
  let controller: SessionController | null = null;
  const clients = createHttpClients({
    baseUrl: 'http://localhost:8080',
    getAccessToken: () => controller?.getAccessToken() ?? null,
    adapter: options.adapter ?? adapter,
  });
  const clearPrivateData = vi.fn(options.clearPrivateData ?? (() => undefined));
  controller = createSessionController({
    transport: clients.auth,
    coordination: hub.connect(),
    clearPrivateData,
  });
  return {
    controller,
    privateApi: createPrivateApi(clients.business, controller),
    adapter,
    hub,
    clearPrivateData,
  };
}
