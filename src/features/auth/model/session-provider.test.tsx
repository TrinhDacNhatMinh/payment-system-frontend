import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createHttpClients } from '@/shared/api/http-client';
import { createApiAdapter, successReply } from '@/test/api-adapter';
import { createSessionCoordinationHub } from '@/test/session-coordination';
import { useAuthFormActions } from './auth-form-actions';
import { useAuthSession } from './session-context';
import { CoordinationUnavailableError } from './session-control';
import { createSessionController } from './session-controller';
import { SessionProvider } from './session-provider';

function SessionProbe() {
  const session = useAuthSession();
  const actions = useAuthFormActions();
  return (
    <>
      <output>{session?.state.status}</output>
      <button disabled={!actions}>Sign in</button>
    </>
  );
}

describe('session provider lifecycle', () => {
  it('connects real actions and wakes the controller without duplicate StrictMode bootstrap', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const adapter = createApiAdapter([
      successReply({ headerName: 'X-XSRF-TOKEN', token: 'masked-csrf' }),
      successReply({
        accessToken: 'memory-only',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: { id: 1, email: 'member@example.com', role: 'USER' },
      }),
    ]);
    const { auth } = createHttpClients({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => null,
      adapter,
    });
    const controller = createSessionController({
      transport: auth,
      coordination: createSessionCoordinationHub().connect(),
      clearPrivateData: vi.fn(),
    });
    const wake = vi.spyOn(controller, 'checkDeadline');
    const view = render(
      <StrictMode>
        <SessionProvider controller={controller}>
          <SessionProbe />
        </SessionProvider>
      </StrictMode>,
    );
    await screen.findByText('authenticated');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(adapter).toHaveBeenCalledTimes(2);
    fireEvent.focus(window);
    expect(wake).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(controller.getAccessToken()).toBeNull();
    fireEvent.focus(window);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('withholds form actions when browser coordination cannot initialize', async () => {
    const adapter = createApiAdapter([]);
    const { auth } = createHttpClients({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => null,
      adapter,
    });
    const connection = createSessionCoordinationHub().connect();
    const controller = createSessionController({
      transport: auth,
      clearPrivateData: vi.fn(),
      coordination: {
        ...connection,
        subscribe: () => {
          throw new CoordinationUnavailableError();
        },
      },
    });
    render(
      <SessionProvider controller={controller}>
        <SessionProbe />
      </SessionProvider>,
    );
    await screen.findByText('unsupported');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(adapter).not.toHaveBeenCalled();
  });
});
