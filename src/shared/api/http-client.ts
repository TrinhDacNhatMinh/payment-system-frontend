import axios, { type AxiosAdapter, type AxiosResponse } from 'axios';
import type { z } from 'zod';

import { parseEnvironment } from '@/shared/config/env-schema';
import { ApiError, normalizeApiError } from './api-error';
import { parseBaseResponse } from './base-response';

const REQUEST_TIMEOUT_MS = 15_000;
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

export type RequestOptions = {
  method: 'GET' | 'HEAD' | 'POST' | 'PATCH';
  path: string;
  data?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  csrfToken?: string;
  idempotencyKey?: string;
};

export interface ApiTransport {
  request<T>(options: RequestOptions, schema: z.ZodType<T>): Promise<T>;
}

type HttpClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null;
  adapter?: AxiosAdapter;
};

function validatePath(path: string, method: RequestOptions['method'], auth: boolean) {
  // Endpoints are developer-owned paths. Query values belong in params, not
  // URLs supplied by a server (including VNPay paymentUrl) or user input.
  if (!/^\/api\/v1\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes('//')) {
    throw new ApiError('client');
  }
  const isAuthPath = path === '/api/v1/auth' || path.startsWith('/api/v1/auth/');
  if (auth) {
    const allowed =
      method === 'GET'
        ? path === '/api/v1/auth/csrf'
        : method === 'POST' && /^\/api\/v1\/auth\/(register|login|refresh|logout)$/.test(path);
    if (!allowed) throw new ApiError('client');
  } else if (isAuthPath) {
    throw new ApiError('client');
  }
}

export function createHttpClients(options: HttpClientOptions) {
  const { apiBaseUrl } = parseEnvironment({ VITE_API_BASE_URL: options.baseUrl });

  function createTransport(auth: boolean): ApiTransport {
    const instance = axios.create({
      baseURL: apiBaseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      withCredentials: auth,
      withXSRFToken: false,
      xsrfCookieName: '',
      xsrfHeaderName: '',
      allowAbsoluteUrls: false,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
      headers: { Accept: 'application/json' },
      validateStatus: () => true,
      ...(options.adapter ? { adapter: options.adapter } : {}),
    });

    return {
      async request<T>(request: RequestOptions, schema: z.ZodType<T>): Promise<T> {
        try {
          validatePath(request.path, request.method, auth);
          const headers: Record<string, string> = {};
          if (request.idempotencyKey !== undefined) {
            if (
              auth ||
              request.method !== 'POST' ||
              request.path !== '/api/v1/transfer' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                request.idempotencyKey,
              )
            ) {
              throw new ApiError('client');
            }
            headers['Idempotency-Key'] = request.idempotencyKey;
          }
          if (request.method !== 'GET' && request.method !== 'HEAD')
            headers['Content-Type'] = 'application/json';
          if (auth && request.method === 'POST') {
            if (!request.csrfToken) throw new ApiError('client');
            headers[CSRF_HEADER_NAME] = request.csrfToken;
          }
          if (!auth) {
            const accessToken = options.getAccessToken();
            if (!accessToken) throw new ApiError('business', { code: 'UNAUTHORIZED' });
            headers.Authorization = `Bearer ${accessToken}`;
          }

          const response = await instance.request<unknown, AxiosResponse<unknown>, unknown>({
            method: request.method,
            url: request.path,
            data: request.data,
            params: request.params,
            signal: request.signal,
            headers,
          });
          if (request.method === 'HEAD' && response.status >= 200 && response.status < 300) {
            const result = schema.safeParse(undefined);
            if (!result.success) throw new ApiError('protocol', { status: response.status });
            return result.data;
          }
          return parseBaseResponse(response.data, response.status, schema);
        } catch (error) {
          throw normalizeApiError(error);
        }
      },
    };
  }

  // Raw transports never refresh/replay. The auth feature wraps business calls
  // with session checks; auth calls remain outside that wrapper.
  return { auth: createTransport(true), business: createTransport(false) };
}
