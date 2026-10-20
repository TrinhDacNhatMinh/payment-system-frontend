import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ContentState } from './content-state';

describe('content feedback', () => {
  it('announces session restoration as busy', () => {
    render(<ContentState kind="loading" title="Restoring your session…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers an explicit retry for a loading error', async () => {
    const onRetry = vi.fn();
    render(
      <ContentState
        kind="error"
        title="Unable to check your session"
        description="Check your connection and try again."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to check your session');
    expect(onRetry).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
