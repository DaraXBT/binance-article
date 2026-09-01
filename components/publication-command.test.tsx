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

  it.each([
    [
      'X_LOGIN_REQUIRED',
      'Log in to X in the companion Chrome window, then prepare again.',
    ],
    [
      'X_ARTICLES_UNAVAILABLE',
      'X Articles are unavailable for this account. Use an X Post or enable Articles access, then prepare again.',
    ],
  ])('shows actionable guidance for companion abort %s', (failureReason, guidance) => {
    render(<PublicationCommandPanel
      command={{ ...command, state: 'cancelled', failureReason }}
      error={null}
      isApproving={false}
      isCancelling={false}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />, { wrapper: EnglishLanguageProvider });

    expect(screen.getByText(guidance)).toBeTruthy();
    expect(screen.queryByText(failureReason)).toBeNull();
  });

  it('uses safe recovery copy for an unknown companion failure reason', () => {
    const upstreamDetail = 'Editor crashed after receiving secret publisher metadata.';
    render(<PublicationCommandPanel
      command={{ ...command, state: 'failed', failureReason: upstreamDetail }}
      error={null}
      isApproving={false}
      isCancelling={false}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
    />, { wrapper: EnglishLanguageProvider });

    expect(screen.getAllByText('Publication failed before a verified result.')).toHaveLength(2);
    expect(screen.queryByText(upstreamDetail)).toBeNull();
  });

  it('renders guidance after the companion asynchronously aborts an X Article', async () => {
    const queued = { ...command, kind: 'article' as const, state: 'queued' as const };
    const aborted = {
      ...queued,
      state: 'cancelled' as const,
      failureReason: 'X_LOGIN_REQUIRED',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      command: aborted,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { result, unmount } = renderHook(
      () => usePublicationCommand('x', 'article_1', 'article'),
      { wrapper: EnglishLanguageProvider },
    );

    await act(async () => {
      await result.current.prepare(async () => ({ command: queued }));
    });
    await waitFor(() => expect(result.current.command).toEqual(aborted), { timeout: 2_500 });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/publisher/commands/${command.id}`,
      expect.objectContaining({ cache: 'no-store' }),
    );

    render(<PublicationCommandPanel
      command={result.current.command}
      error={result.current.error}
      isApproving={result.current.isApproving}
      isCancelling={result.current.isCancelling}
      onApprove={result.current.approve}
      onCancel={result.current.cancel}
    />, { wrapper: EnglishLanguageProvider });
    expect(screen.getByText(
      'Log in to X in the companion Chrome window, then prepare again.',
    )).toBeTruthy();
    unmount();
  });

  it('uses the local fallback instead of an unknown server error body', async () => {
    const upstreamDetail = 'No paired publisher device is online. Request ID: secret-123.';
    const response = new Response(JSON.stringify({
      error: upstreamDetail,
      code: 'PUBLISHER_DEVICE_OFFLINE',
    }), { status: 409, headers: { 'content-type': 'application/json' } });

    await expect(readPublicationResponse(response, 'Publication preparation failed.'))
      .rejects.toThrow('Publication preparation failed.');
  });

  it.each([
    ['X_LOGIN_REQUIRED', 'Log in to X in the companion Chrome window, then prepare again.'],
    [
      'X_ARTICLES_UNAVAILABLE',
      'X Articles are unavailable for this account. Use an X Post or enable Articles access, then prepare again.',
    ],
  ])('maps known response code %s to localized recovery guidance', async (code, guidance) => {
    const response = new Response(JSON.stringify({
      code,
      error: 'Untrusted upstream wording must not be rendered.',
    }), { status: 409, headers: { 'content-type': 'application/json' } });

    await expect(readPublicationResponse(response, 'Publication preparation failed.', {
      xLoginRequired: 'Log in to X in the companion Chrome window, then prepare again.',
      xArticlesUnavailable: 'X Articles are unavailable for this account. Use an X Post or enable Articles access, then prepare again.',
    })).rejects.toThrow(guidance);
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
