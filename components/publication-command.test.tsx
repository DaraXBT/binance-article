// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from './language-provider';
import {
  PublicationCommandPanel,
  readPublicationResponse,
  usePublicationCommand,
  type PublicationCommand,
} from './publication-command';

function EnglishLanguageProvider({ children }: React.PropsWithChildren) {
  return <LanguageProvider initialLanguage="en">{children}</LanguageProvider>;
}

const command: PublicationCommand = {
  id: 'command_1',
  draftId: 'draft_1',
  target: 'x',
  state: 'awaiting_review',
  revision: 2,
  recipeHash: 'a'.repeat(64),
  expiresAt: '2026-07-22T01:00:00.000Z',
};

describe('reviewed publication command UI', () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('restores a prepared command after a page refresh', async () => {
    window.sessionStorage.setItem(
      'xarticle:publication-command:x:article_1',
      command.id,
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      command,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const { result, unmount } = renderHook(
      () => usePublicationCommand('x', 'article_1'),
      { wrapper: EnglishLanguageProvider },
    );

    await waitFor(() => expect(result.current.command?.id).toBe(command.id));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/publisher/commands/command_1',
      expect.objectContaining({ cache: 'no-store' }),
    );
    unmount();
  });

  it('stores active prepared commands and clears terminal commands', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      command: { ...command, state: 'cancelled' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { result, unmount } = renderHook(
      () => usePublicationCommand('x', 'article_1'),
      { wrapper: EnglishLanguageProvider },
    );

    await act(async () => {
      await result.current.prepare(async () => ({ command }));
    });
    expect(window.sessionStorage.getItem('xarticle:publication-command:x:article_1'))
      .toBe(command.id);

    await act(async () => {
      await result.current.cancel();
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(window.sessionStorage.getItem('xarticle:publication-command:x:article_1'))
      .toBeNull();
    unmount();
  });

  it('shows the terminal companion failure code', () => {
    render(<PublicationCommandPanel
      command={{ ...command, state: 'failed', failureReason: 'EDITOR_COMPOSITION_FAILED' }}
      error={null}
      isApproving={false}
      isCancelling={false}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />, { wrapper: EnglishLanguageProvider });

    expect(screen.getByText(/EDITOR_COMPOSITION_FAILED/)).toBeTruthy();
  });

  it('preserves the sanitized server error instead of replacing it with a generic fallback', async () => {
    const response = new Response(JSON.stringify({
      error: 'No paired publisher device is online.',
      code: 'PUBLISHER_DEVICE_OFFLINE',
    }), { status: 409, headers: { 'content-type': 'application/json' } });

    await expect(readPublicationResponse(response, 'Publication preparation failed.'))
      .rejects.toThrow('No paired publisher device is online.');
  });

  it('explains the one-click approval boundary', () => {
    render(<PublicationCommandPanel
      command={command}
      error={null}
      isApproving={false}
      isCancelling={false}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />, { wrapper: EnglishLanguageProvider });
    expect(screen.getByText(/Inspect it in Chrome/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve one publish click' })).toBeTruthy();
  });

  it('cancels only the prepared command revision and recipe hash', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      command: { ...command, state: 'cancelled' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { result, unmount } = renderHook(() => usePublicationCommand('x'), {
      wrapper: EnglishLanguageProvider,
    });
    await act(async () => {
      await result.current.prepare(async () => ({ command }));
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/publisher/commands/command_1', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({
        revision: 2,
        recipeHash: 'a'.repeat(64),
        confirmed: true,
      }),
    }));
    expect(result.current.command?.state).toBe('cancelled');
    unmount();
  });

  it('approves only the prepared command revision and recipe hash', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      command: { ...command, state: 'approved' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { result, unmount } = renderHook(() => usePublicationCommand('x'), {
      wrapper: EnglishLanguageProvider,
    });
    await act(async () => {
      await result.current.prepare(async () => ({ command }));
    });
    await act(async () => {
      await result.current.approve();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/publisher/commands/command_1/approve', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        revision: 2,
        recipeHash: 'a'.repeat(64),
        confirmed: true,
      }),
    }));
    expect(result.current.command?.state).toBe('approved');
    unmount();
  });
});
