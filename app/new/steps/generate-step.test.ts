// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({
    messages: {
      generateAccess: { submit: 'Unlock generation' },
      newDeck: {
        generateView: {
          creatingDeck: 'Creating deck',
          generatingSlideContent: 'Generating slide content',
          generatingBlogAndX: 'Generating blog and X captions',
          generatingImages: 'Generating images',
          generatingDeck: 'Generating deck',
          workingDescription: 'This can take a moment.',
          progress: 'Progress',
          createDeckError: 'Could not create deck',
          generateSlidesError: 'Could not generate slides',
          unknownError: 'Unknown error',
        },
      },
    },
  }),
}));

vi.mock('@/components/image-generation-loader', () => ({
  ImageGenerationLoader: ({
    label,
    detail,
    className,
  }: {
    label: string;
    detail?: string;
    className?: string;
  }) => React.createElement('div', {
    'data-testid': 'image-generation-loader',
    'data-label': label,
    'data-detail': detail,
    className,
  }),
}));

vi.mock('@/components/generate-access-dialog', () => ({
  GenerateAccessDialog: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    React.createElement('button', props, children)
  ),
}));

vi.mock('@/lib/generate-access-error', () => ({
  GenerateAccessError: class GenerateAccessError extends Error {
    static isGenerateAccessResponse() {
      return false;
    }
  },
}));

import {
  GenerateStep,
  phaseForRunningJob,
  readLatestImageProgress,
} from './generate-step';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAtImageProgress(progress: number, processed: number, total: number) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ id: 'deck_1' }))
    .mockResolvedValueOnce(jsonResponse({ jobId: 'job_1' }))
    .mockResolvedValueOnce(jsonResponse({
      id: 'job_1',
      status: 'running',
      progress,
      logs: [
        {
          timestamp: '2026-07-25T00:00:00.000Z',
          message: 'Generating slide images.',
          level: 'info',
          meta: { processed, total },
        },
      ],
    }));
  vi.stubGlobal('fetch', fetchMock);

  render(React.createElement(GenerateStep, {
    formData: {
      title: 'A test article',
      articleContent: 'An article body that is long enough to generate.',
      slideCount: total,
      illustrationStyle: 'binance-master',
    },
    mode: 'text',
  }));

  return fetchMock;
}

describe('GenerateStep job progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
      if (timeout === 1500) {
        return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
      }
      return realSetTimeout(handler, timeout, ...args);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats everything before the image stage as slide work', () => {
    expect(phaseForRunningJob(44)).toBe('generating-slides');
    expect(phaseForRunningJob(45)).toBe('generating-slides');
    expect(phaseForRunningJob(54)).toBe('generating-slides');
    expect(phaseForRunningJob(55)).toBe('generating-images');
    expect(phaseForRunningJob(95)).toBe('generating-images');
  });

  it('sends one idempotency key on both the create and generate calls', async () => {
    const fetchMock = renderAtImageProgress(55, 0, 4);

    await screen.findByTestId('image-generation-loader');

    const createHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const generateHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    const key = createHeaders.get('Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(generateHeaders.get('Idempotency-Key')).toBe(key);
  });

  it('reads the newest valid live image count and skips malformed newer metadata', () => {
    const progress = readLatestImageProgress([
      {
        timestamp: '2026-07-25T00:00:00.000Z',
        message: 'Generating slide images.',
        level: 'info',
        meta: { processed: 0, total: 4 },
      },
      {
        timestamp: '2026-07-25T00:00:01.000Z',
        message: 'Generated slide images.',
        level: 'info',
        meta: { processed: 3, total: 4 },
      },
      {
        timestamp: '2026-07-25T00:00:02.000Z',
        message: 'Unrelated malformed metadata.',
        level: 'info',
        meta: { processed: 8, total: 4 },
      },
    ]);

    expect(progress).toEqual({ current: 3, total: 4 });
  });

  it('accepts the initial zero-count image progress metadata', () => {
    expect(readLatestImageProgress([
      {
        timestamp: '2026-07-25T00:00:00.000Z',
        message: 'Generating slide images.',
        level: 'info',
        meta: { processed: 0, total: 1 },
      },
    ])).toEqual({ current: 0, total: 1 });
  });

  it('renders the image loader with its initial zero-count detail', async () => {
    renderAtImageProgress(55, 0, 4);

    const loader = await screen.findByTestId('image-generation-loader');
    expect(loader.getAttribute('data-label')).toBe('Generating images');
    expect(loader.getAttribute('data-detail')).toBe('0/4');
    expect(loader.className).toContain('aspect-video');
  });

  it('keeps the image loader visible with live counts when progress jumps to 95%', async () => {
    renderAtImageProgress(95, 3, 4);

    const loader = await screen.findByTestId('image-generation-loader');
    expect(loader.getAttribute('data-detail')).toBe('3/4');
    expect(screen.getByText('95%')).toBeTruthy();
  });
});
