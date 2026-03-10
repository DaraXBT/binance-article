// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const messages = {
  accessGate: {
    title: 'Private access',
    codePlaceholder: 'Enter access code',
    submit: 'Continue',
    submitting: 'Checking...',
    invalidCode: 'Invalid access code',
  },
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ language: 'en', messages }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => React.createElement('button', props, children),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => React.createElement('input', props),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => React.createElement('label', props, children),
}));

describe('AccessGateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /workspace after successful access grant', async () => {
    const originalLocation = window.location;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '/' },
    });

    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      const { AccessGateForm } = await import('./access-gate-form');
      render(React.createElement(AccessGateForm));

      fireEvent.change(screen.getByLabelText(messages.accessGate.title), {
        target: { value: 'ANGEL' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(window.location.href).toBe('/workspace');
      });
    } finally {
      global.fetch = originalFetch;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
