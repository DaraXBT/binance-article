import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeckDetailResponse, JobStatus, JobSummary } from './schemas';

const reactQueryMocks = vi.hoisted(() => ({
  useQuery: vi.fn((options: unknown) => options),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => reactQueryMocks);

import { useDeck, useSaveWorkspaceAiCredential } from './hooks';

afterEach(() => {
  vi.unstubAllGlobals();
});

type CapturedDeckQueryOptions = {
  refetchInterval: (query: { state: { data?: DeckDetailResponse } }) => number | false;
};

function job(status: JobStatus): JobSummary {
  return {
    id: 'job_1',
    deckId: 'article_1',
    workspaceId: 'workspace_1',
    kind: 'generate_images',
    status,
    progress: 50,
    logs: [],
    articleRevisionId: 'revision_1',
    startedAt: '2026-07-22T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function deck(status: JobStatus): DeckDetailResponse {
  return {
    id: 'article_1',
    status: status === 'queued' || status === 'running' ? 'generating' : 'ready',
    title: 'Market structure',
    slides: [],
    captions: null,
    cover: null,
    lastJob: job(status),
  };
}

function capturedOptions(): CapturedDeckQueryOptions {
  const options = reactQueryMocks.useQuery.mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error('useDeck did not configure a query');
  }
  return options as CapturedDeckQueryOptions;
}

describe('useDeck active-job polling', () => {
  beforeEach(() => {
    reactQueryMocks.useQuery.mockClear();
  });

  it('polls every 1.5 seconds while the latest job is queued or running', () => {
    useDeck('article_1', { pollActiveJob: true });
    const { refetchInterval } = capturedOptions();

    expect(refetchInterval({ state: { data: deck('queued') } })).toBe(1500);
    expect(refetchInterval({ state: { data: deck('running') } })).toBe(1500);
  });

  it.each<JobStatus>(['completed', 'failed', 'cancelled'])(
    'stops polling when the latest job is %s',
    (status) => {
      useDeck('article_1', { pollActiveJob: true });
      const { refetchInterval } = capturedOptions();

      expect(refetchInterval({ state: { data: deck(status) } })).toBe(false);
    },
  );

  it('does not poll unless active-job recovery is enabled', () => {
    useDeck('article_1');
    const { refetchInterval } = capturedOptions();

    expect(refetchInterval({ state: { data: deck('running') } })).toBe(false);
  });
});

describe('useSaveWorkspaceAiCredential secret handling', () => {
  beforeEach(() => {
    reactQueryMocks.useMutation.mockReset();
    reactQueryMocks.useQueryClient.mockReturnValue({ setQueryData: vi.fn() });
  });

  it('keeps the raw key out of React Query mutation variables', async () => {
    const apiKey = 'workspace-secret-key-with-enough-length';
    const baseMutateAsync = vi.fn();
    reactQueryMocks.useMutation.mockImplementation((options: {
      mutationFn: (secretHandle: object) => Promise<unknown>;
    }) => {
      baseMutateAsync.mockImplementation((secretHandle: object) => {
        expect(secretHandle).not.toBe(apiKey);
        expect(JSON.stringify(secretHandle)).not.toContain(apiKey);
        return options.mutationFn(secretHandle);
      });
      return {
        isPending: false,
        error: null,
        mutateAsync: baseMutateAsync,
      };
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ apiKey }));
      return new Response(JSON.stringify({
        provider: 'gemini',
        configured: true,
        activeSource: 'platform',
        validatedAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mutation = useSaveWorkspaceAiCredential();
    await mutation.mutateAsync(apiKey);

    expect(baseMutateAsync).toHaveBeenCalledOnce();
    expect(baseMutateAsync).not.toHaveBeenCalledWith(apiKey);
  });
});
