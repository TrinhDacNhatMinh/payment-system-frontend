import { createHttpClients } from '@/shared/api/http-client';
import { environment } from '@/shared/config/env';

// Composition seam for the session controller; constructing clients sends no
// requests. No token is captured until a business request is actually prepared.
export function createAppApiClients(getAccessToken: () => string | null) {
  return createHttpClients({ baseUrl: environment.apiBaseUrl, getAccessToken });
}
