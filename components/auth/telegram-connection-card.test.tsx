// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  link: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { oauth2: { link: mocks.link } },
}));

describe('Telegram account connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.link.mockResolvedValue({ data: { redirect: true }, error: null });
  });

  it('uses Better Auth account linking and never starts Telegram sign-up', async () => {
    const { TelegramConnectionCard } = await import('./telegram-connection-card');
    render(<TelegramConnectionCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));

    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith({
      providerId: 'telegram',
      callbackURL: '/settings/connections',
    }));
    expect(mocks.link.mock.calls[0][0]).not.toHaveProperty('requestSignUp');
  });

  it('shows a generic error without exposing provider details', async () => {
    mocks.link.mockResolvedValue({ data: null, error: { message: 'sensitive provider detail' } });
    const { TelegramConnectionCard } = await import('./telegram-connection-card');
    render(<TelegramConnectionCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Telegram could not be connected. Please try again.',
    );
    expect(screen.queryByText(/sensitive provider detail/i)).toBeNull();
  });
});
