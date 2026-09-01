// @vitest-environment jsdom

import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

import { ConnectionsDialog } from './connections-dialog';

vi.mock('@/components/workspace-ai-credential-card', () => ({
  WorkspaceAiCredentialCard: () => <div>Your Gemini key</div>,
}));

vi.mock('@/components/admin-people-access-card', () => ({
  AdminPeopleAccessCard: () => <div>People &amp; access</div>,
}));

const pairingRequestState = vi.hoisted(() => ({
  callbacks: [] as Array<(hasUncopiedPairing: boolean) => void>,
}));

vi.mock('@/components/publisher-device-pairing-card', () => ({
  PublisherDevicePairingCard: ({
    onUncopiedPairingChange,
  }: {
    onUncopiedPairingChange?: (hasUncopiedPairing: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (!onUncopiedPairingChange) return;
        pairingRequestState.callbacks.push(onUncopiedPairingChange);
        onUncopiedPairingChange(true);
      }}
    >
      Create pairing code
    </button>
  ),
}));

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button data-testid="open-settings" type="button" onClick={() => setOpen(true)}>
        Open account settings
      </button>
      <ConnectionsDialog
        open={open}
        onOpenChange={setOpen}
        canManageAi
        canManageAccess
      />
    </>
  );
}

describe('ConnectionsDialog pairing request guard', () => {
  beforeEach(() => {
    pairingRequestState.callbacks.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('rejects a discarded pairing callback during exit but accepts the next session', () => {
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.stubGlobal(
      'getComputedStyle',
      (element: Element, pseudoElement?: string | null) => {
        const styles = getComputedStyle(element, pseudoElement);
        if (!(element instanceof HTMLElement) || element.dataset.state === undefined) {
          return styles;
        }
        return new Proxy(styles, {
          get(target, property) {
            if (property === 'animationName') {
              return element.dataset.state === 'closed'
                ? 'settings-dialog-exit'
                : 'settings-dialog-enter';
            }
            return Reflect.get(target, property, target);
          },
        });
      },
    );

    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Publishing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    expect(pairingRequestState.callbacks).toHaveLength(1);
    const completeDiscardedRequest = pairingRequestState.callbacks[0];
    expect(completeDiscardedRequest).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Close account settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));

    expect(document.querySelector<HTMLElement>('[data-connections-dialog]')?.dataset.state)
      .toBe('closed');

    act(() => completeDiscardedRequest?.(true));

    expect(document.querySelector<HTMLElement>('[data-connections-dialog]')?.dataset.state)
      .toBe('closed');
    expect(screen.queryByText('Copy your one-time value before closing.')).toBeNull();

    fireEvent.click(screen.getByTestId('open-settings'));
    fireEvent.click(screen.getByRole('tab', { name: 'Publishing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));
    expect(pairingRequestState.callbacks).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close account settings' }));
    expect(screen.getByText('Copy your one-time value before closing.')).toBeTruthy();
  });
});
