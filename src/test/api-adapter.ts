import { type AxiosAdapter } from 'axios';
import { vi } from 'vitest';

type HttpReply = { status: number; data: unknown };
export type ApiReply = HttpReply | Error;

export function successReply(data?: unknown): HttpReply {
  return { status: 200, data: { success: true, data, timestamp: '2026-10-20T12:00:00Z' } };
}

export function errorReply(code: string, status: number): HttpReply {
  return {
    status,
    data: {
      success: false,
      error: { code, message: 'Raw server text must never reach the UI' },
      timestamp: '2026-10-20T12:00:00Z',
    },
  };
}

export function createApiAdapter(replies: ApiReply[]) {
  let nextReply = 0;
  return vi.fn<AxiosAdapter>(async (config) => {
    const reply = replies[nextReply++];
    if (!reply) throw new Error('Unexpected API request in test');
    if (reply instanceof Error) throw reply;
    return { ...reply, statusText: '', headers: {}, config };
  });
}
