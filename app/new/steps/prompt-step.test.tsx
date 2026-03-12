// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    language: 'en',
    messages: {
      dashboard: {
        aiSuggest: 'AI Suggest',
        aiSuggestLoading: 'Suggesting...',
      },
      newDeck: {
        promptView: {
          title: 'Generate with AI',
          subtitle: 'Describe the topic or idea you want to present. Our AI will write the full article and generate the slides for you.',
          topicLabel: 'Topic Title',
          topicPlaceholder: 'e.g., The Future of Web3 Wallets',
          promptLabel: 'Detailed Instructions (Prompt)',
          promptPlaceholder: 'Write a comprehensive article...',
          promptHintWithTopic: 'Click AI Suggest to auto-generate instructions from your prompt, or write your own.',
          promptHintEmpty: 'Enter your prompt, then click AI Suggest to auto-generate.',
        },
      },
    },
  }),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => React.createElement('input', props),
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.ComponentProps<'textarea'>) => React.createElement('textarea', props),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => React.createElement('label', props, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => React.createElement('button', props, children),
}));

vi.mock('lucide-react', () => ({
  Loader2: (props: React.ComponentProps<'svg'>) => React.createElement('svg', props),
  Sparkles: (props: React.ComponentProps<'svg'>) => React.createElement('svg', props),
}));

vi.mock('@/components/generate-access-dialog', () => ({
  GenerateAccessDialog: () => null,
}));

vi.mock('@/lib/generate-access-error', () => ({
  GenerateAccessError: class GenerateAccessError extends Error {
    constructor() { super('Generate access required'); }
    static isGenerateAccessResponse(status: number, data: unknown) {
      return status === 403 && (data as Record<string, string>)?.code === 'GENERATE_ACCESS_REQUIRED';
    }
  },
}));

describe('PromptStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders AI Suggest and fills the prompt from the shared prompt API helper', async () => {
    const { PromptStep } = await import('@/app/new/steps/prompt-step');
    const onUpdate = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ prompt: 'Generated prompt body' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { container } = render(
      React.createElement(PromptStep, {
        formData: { title: 'Bitcoin ETF inflows', articleContent: 'Write about Bitcoin ETF inflows' },
        onUpdate,
        fetchImpl: fetchMock,
      })
    );

    const button = screen.getByRole('button', { name: /ai suggest/i });

    expect(container.innerHTML).toContain('ai-suggest-glow');
    expect(container.innerHTML).toContain('ai-suggest-sweep');

    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/articles/generate-prompt',
        expect.objectContaining({ method: 'POST' })
      );
      expect(onUpdate).toHaveBeenCalledWith({ articleContent: 'Generated prompt body' });
    });
  });

  it('keeps AI Suggest unavailable when the title is empty', async () => {
    const { PromptStep } = await import('@/app/new/steps/prompt-step');

    render(
      React.createElement(PromptStep, {
        formData: { title: '', articleContent: '' },
        onUpdate: vi.fn(),
      })
    );

    expect(screen.getByRole('button', { name: /ai suggest/i }).hasAttribute('disabled')).toBe(true);
  });

  it('disables the textarea and shows loading copy while generating', async () => {
    const { PromptStep } = await import('@/app/new/steps/prompt-step');
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(
      React.createElement(PromptStep, {
        formData: { title: 'Bitcoin ETF inflows', articleContent: 'Write about Bitcoin ETF inflows' },
        onUpdate: vi.fn(),
        fetchImpl: fetchMock,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /ai suggest/i }));

    expect(screen.getByRole('button', { name: /suggesting/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('textbox', { name: /detailed instructions/i }).hasAttribute('disabled')).toBe(true);

    resolveFetch?.(
      new Response(JSON.stringify({ prompt: 'Done' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the inline error when prompt generation fails', async () => {
    const { PromptStep } = await import('@/app/new/steps/prompt-step');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Failed to generate prompt' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      React.createElement(PromptStep, {
        formData: { title: 'Bitcoin ETF inflows', articleContent: 'Write about Bitcoin ETF inflows' },
        onUpdate: vi.fn(),
        fetchImpl: fetchMock,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /ai suggest/i }));

    expect(await screen.findByText(/failed to generate prompt/i)).toBeTruthy();
  });

  it('uses the shared AI Suggest glow contract for ready, suggesting, and empty-title states', async () => {
    const { PromptStep } = await import('@/app/new/steps/prompt-step');
    const { getAiSuggestGlowClassName } = await import('@/components/home/dashboard-home');

    const readyRender = render(
      React.createElement(PromptStep, {
        formData: { title: 'Bitcoin ETF inflows', articleContent: 'Write about Bitcoin ETF inflows' },
        onUpdate: vi.fn(),
      })
    );
    const readyGlow = readyRender.container.querySelector('span[aria-hidden="true"]');
    expect(readyGlow?.className).toBe(
      getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })
    );
    cleanup();

    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const suggestingRender = render(
      React.createElement(PromptStep, {
        formData: { title: 'Bitcoin ETF inflows', articleContent: 'Write about Bitcoin ETF inflows' },
        onUpdate: vi.fn(),
        fetchImpl: fetchMock,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /ai suggest/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /suggesting/i })).toBeTruthy();
    });
    const suggestingGlow = suggestingRender.container.querySelector('span[aria-hidden="true"]');
    expect(suggestingGlow?.className).toBe(
      getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })
    );
    resolveFetch?.(
      new Response(JSON.stringify({ prompt: 'Done' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    cleanup();

    const emptyRender = render(
      React.createElement(PromptStep, {
        formData: { title: '', articleContent: '' },
        onUpdate: vi.fn(),
      })
    );
    const emptyGlow = emptyRender.container.querySelector('span[aria-hidden="true"]');
    expect(emptyGlow?.className).toBe(
      getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false })
    );
  });
});
