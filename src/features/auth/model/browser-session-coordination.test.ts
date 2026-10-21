import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/api/api-error';
import { createBrowserSessionCoordination } from './browser-session-coordination';
import {
  AUTH_CHANNEL_NAME,
  AUTH_CONTROL_KEY,
  AUTH_CONTROL_LOCK_NAME,
  AUTH_LOCK_NAME,
  CoordinationUnavailableError,
  type AuthControl,
} from './session-control';

const control: AuthControl = {
  version: 1,
  epoch: '00000000-0000-4000-8000-000000000001',
  mode: 'active',
};

class TestChannel extends EventTarget {
  static instances: TestChannel[] = [];
  postMessage = vi.fn();
  close = vi.fn();
  constructor(readonly name: string) {
    super();
    TestChannel.instances.push(this);
  }
}

const request = vi.fn(async (...args: unknown[]) => {
  const callback = args.at(-1);
  if (typeof callback !== 'function') throw new Error('Missing lock callback');
  return callback();
});

beforeEach(() => {
  window.localStorage.clear();
  TestChannel.instances = [];
  request.mockClear();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('BroadcastChannel', TestChannel);
  vi.stubGlobal('crypto', { randomUUID: () => control.epoch });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('browser session coordination', () => {
  it('atomically writes strict markers and broadcasts only a change notification', async () => {
    const coordination = createBrowserSessionCoordination();
    const unsubscribe = coordination.subscribe(vi.fn());
    await coordination.change(() => control);
    expect(request.mock.calls[0]?.[0]).toBe(AUTH_CONTROL_LOCK_NAME);
    expect(JSON.parse(window.localStorage.getItem(AUTH_CONTROL_KEY) ?? 'null')).toEqual(control);
    const channel = TestChannel.instances[0];
    expect(channel?.name).toBe(AUTH_CHANNEL_NAME);
    expect(channel?.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'control-changed' });
    await coordination.change((current) => (current === 'invalid' ? null : current));
    expect(channel?.postMessage).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(channel?.close).toHaveBeenCalledTimes(1);
  });

  it('uses the network auth lock with cancellation and preserves operation errors', async () => {
    const coordination = createBrowserSessionCoordination();
    const abort = new AbortController();
    await expect(coordination.runExclusive(async () => 'result', abort.signal)).resolves.toBe(
      'result',
    );
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual([
      AUTH_LOCK_NAME,
      { mode: 'exclusive', signal: abort.signal },
    ]);
    const failure = new ApiError('network');
    await expect(
      coordination.runExclusive(() => Promise.reject(failure), abort.signal),
    ).rejects.toBe(failure);
  });

  it('listens to storage and channel invalidation and removes listeners on cleanup', () => {
    const coordination = createBrowserSessionCoordination();
    const listener = vi.fn();
    const unsubscribe = coordination.subscribe(listener);
    const channel = TestChannel.instances[0];
    window.dispatchEvent(new StorageEvent('storage', { key: 'another-key' }));
    channel?.dispatchEvent(new MessageEvent('message', { data: { accessToken: 'ignored' } }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CONTROL_KEY }));
    channel?.dispatchEvent(new MessageEvent('message', { data: { type: 'control-changed' } }));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CONTROL_KEY }));
    channel?.dispatchEvent(new MessageEvent('message', { data: { type: 'control-changed' } }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not write an active marker without an open channel', async () => {
    const coordination = createBrowserSessionCoordination();
    await expect(coordination.change(() => control)).rejects.toBeInstanceOf(
      CoordinationUnavailableError,
    );
    expect(window.localStorage.getItem(AUTH_CONTROL_KEY)).toBeNull();
  });

  it('fails closed if storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    const coordination = createBrowserSessionCoordination();
    expect(() => coordination.subscribe(vi.fn())).toThrow(CoordinationUnavailableError);
    expect(TestChannel.instances).toHaveLength(0);
  });

  it('fails closed if Web Locks are unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(() => createBrowserSessionCoordination().read()).toThrow(CoordinationUnavailableError);
  });
});
