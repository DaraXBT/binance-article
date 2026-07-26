'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateSlideRequest,
  DeckDetailResponse,
  DeckGenerateRequest,
  SlideUpdateRequest,
} from '@/lib/schemas';

type DeckMutationInput = {
  deckId: string;
  title?: string;
  description?: string;
  theme?: string;
  status?: string;
};

export type WorkspaceBootstrap = {
  hasWorkspace: boolean;
  workspaceId: string | null;
  accessKeyPrefix: string | null;
  recoveryKey: string | null;
  workspaceOrigin: 'legacy' | 'account' | null;
  workspaceRole: 'owner' | 'member' | null;
  canReplaceWithLegacy: boolean;
  generateAccessEnabled: boolean;
  hasGenerationAccess: boolean;
  generationAccessInvalidReason:
    | 'missing'
    | 'invalid'
    | 'rotated'
    | 'workspace_mismatch'
    | 'session_mismatch'
    | 'revoked'
    | null;
};

export type WorkspaceAiCredentialSource = 'platform' | 'workspace';

export type WorkspaceAiCredentialStatus = {
  provider: 'gemini';
  configured: boolean;
  activeSource: WorkspaceAiCredentialSource;
  validatedAt: string | null;
  updatedAt: string | null;
};

// TanStack Query retains mutation variables for inspection and retries. Keep
// credential plaintext out of that state by passing an opaque, one-use handle
// through the mutation and holding the value only until the request begins.
const pendingWorkspaceAiCredentialKeys = new WeakMap<object, string>();

export type WorkspaceCreateResult = {
  success: true;
  workspaceId: string;
  created: boolean;
};

export type WorkspaceRecoveryResult = {
  success: true;
  workspaceId: string;
  replacedWorkspace: boolean;
};

export class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, options: { code?: string; status: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
  }
}

async function readApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(data?.error || fallbackMessage, {
      code: typeof data?.code === 'string' ? data.code : undefined,
      status: res.status,
    });
  }

  return data as T;
}

export const queryKeys = {
  all: ['decks'] as const,
  lists: () => [...queryKeys.all, 'list'] as const,
  detail: (id: string) => [...queryKeys.all, 'detail', id] as const,
  jobs: () => [...queryKeys.all, 'jobs'] as const,
  job: (id: string) => [...queryKeys.jobs(), id] as const,
  workspace: () => ['workspace'] as const,
  workspaceAiCredential: () => ['workspace', 'ai-credential'] as const,
};

async function fetchDecks() {
  const res = await fetch('/api/articles');
  return readApiResponse(res, 'Failed to fetch decks');
}

async function fetchDeck(id: string): Promise<DeckDetailResponse> {
  const res = await fetch(`/api/articles/${id}`);
  return readApiResponse<DeckDetailResponse>(res, 'Failed to fetch deck');
}

async function fetchJob(jobId: string) {
  const res = await fetch(`/api/jobs/${jobId}`);
  return readApiResponse(res, 'Failed to fetch job');
}

async function fetchWorkspace() {
  const res = await fetch('/api/workspace');
  return readApiResponse<WorkspaceBootstrap>(res, 'Failed to fetch workspace');
}

async function fetchWorkspaceAiCredential() {
  const res = await fetch('/api/workspace/ai-credential', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  return readApiResponse<WorkspaceAiCredentialStatus>(
    res,
    'Failed to fetch Gemini connection',
  );
}

export function useDecks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchDecks,
    staleTime: 30000,
    enabled,
  });
}

export type UseDeckOptions = {
  pollActiveJob?: boolean;
};

export function useDeck(id: string, { pollActiveJob = false }: UseDeckOptions = {}) {
  return useQuery<DeckDetailResponse, ApiError>({
    queryKey: queryKeys.detail(id),
    queryFn: () => fetchDeck(id),
    staleTime: 10000,
    enabled: Boolean(id),
    refetchInterval: (query) => {
      if (!pollActiveJob) {
        return false;
      }

      const jobStatus = query.state.data?.lastJob?.status;
      return jobStatus === 'queued' || jobStatus === 'running' ? 1500 : false;
    },
  });
}

export function useJob(jobId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => fetchJob(jobId),
    refetchInterval: 1000,
    enabled: enabled && Boolean(jobId),
  });
}

export function useWorkspace() {
  return useQuery<WorkspaceBootstrap, ApiError>({
    queryKey: queryKeys.workspace(),
    queryFn: fetchWorkspace,
    staleTime: 30000,
  });
}

/**
 * Single source of truth for the generation-access lock. An unlock/lost
 * signal is reflected locally right away (the grant cookie is already set or
 * cleared) and confirmed by a workspace refetch.
 */
export function useGenerationLock() {
  const workspaceQuery = useWorkspace();
  const workspace = workspaceQuery.data;
  const [hasLocalAccess, setHasLocalAccess] = useState(false);

  useEffect(() => {
    setHasLocalAccess(workspace?.hasGenerationAccess ?? false);
  }, [workspace?.hasGenerationAccess]);

  const generationLocked = Boolean(
    workspace?.generateAccessEnabled
    && !(hasLocalAccess || workspace.hasGenerationAccess),
  );

  const refetchWorkspace = workspaceQuery.refetch;
  const unlockGeneration = useCallback(() => {
    setHasLocalAccess(true);
    void refetchWorkspace();
  }, [refetchWorkspace]);

  const markGenerationAccessLost = useCallback(() => {
    setHasLocalAccess(false);
    void refetchWorkspace();
  }, [refetchWorkspace]);

  return { generationLocked, unlockGeneration, markGenerationAccessLost, workspaceQuery };
}

export function useWorkspaceAiCredential(enabled = true) {
  return useQuery<WorkspaceAiCredentialStatus, ApiError>({
    queryKey: queryKeys.workspaceAiCredential(),
    queryFn: fetchWorkspaceAiCredential,
    staleTime: 30_000,
    enabled,
  });
}

export function useSaveWorkspaceAiCredential() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    retry: false,
    mutationFn: async (secretHandle: object) => {
      const apiKey = pendingWorkspaceAiCredentialKeys.get(secretHandle);
      pendingWorkspaceAiCredentialKeys.delete(secretHandle);
      if (!apiKey) {
        throw new ApiError('The Gemini key is no longer available. Paste it again.', {
          code: 'AI_CREDENTIAL_INPUT_UNAVAILABLE',
          status: 400,
        });
      }
      const res = await fetch('/api/workspace/ai-credential', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      return readApiResponse<WorkspaceAiCredentialStatus>(
        res,
        'Failed to save Gemini connection',
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.workspaceAiCredential(), data);
    },
  });

  return {
    ...mutation,
    mutateAsync: async (apiKey: string) => {
      const secretHandle = {};
      pendingWorkspaceAiCredentialKeys.set(secretHandle, apiKey);
      try {
        return await mutation.mutateAsync(secretHandle);
      } finally {
        pendingWorkspaceAiCredentialKeys.delete(secretHandle);
      }
    },
  };
}

export function useTestWorkspaceAiCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workspace/ai-credential', {
        method: 'POST',
        credentials: 'same-origin',
      });
      return readApiResponse<WorkspaceAiCredentialStatus>(
        res,
        'Failed to test Gemini connection',
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.workspaceAiCredential(), data);
    },
  });
}

export function useSetWorkspaceAiCredentialSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (source: WorkspaceAiCredentialSource) => {
      const res = await fetch('/api/workspace/ai-credential', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      return readApiResponse<WorkspaceAiCredentialStatus>(
        res,
        'Failed to change Gemini source',
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.workspaceAiCredential(), data);
    },
  });
}

export function useDeleteWorkspaceAiCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workspace/ai-credential', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      return readApiResponse<WorkspaceAiCredentialStatus>(
        res,
        'Failed to delete Gemini connection',
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.workspaceAiCredential(), data);
    },
  });
}

export function useCreateDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      title: string;
      content: string;
      description?: string;
      illustrationStyle?: string;
    }) => {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      return readApiResponse(res, 'Failed to create deck');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useGenerateDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      deckId,
      ...request
    }: DeckGenerateRequest & { deckId: string }) => {
      const res = await fetch(`/api/articles/${deckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      return readApiResponse<{ deckId?: string }>(res, 'Failed to generate deck');
    },
    onSuccess: (data: { deckId?: string }) => {
      if (data.deckId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.detail(data.deckId) });
      }
    },
  });
}

export function useRenderDeck() {
  return useMutation({
    mutationFn: async (deckId: string) => {
      const res = await fetch(`/api/articles/${deckId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      return readApiResponse(res, 'Failed to start render job');
    },
  });
}

export function useUpdateDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ deckId, ...data }: DeckMutationInput) => {
      const res = await fetch(`/api/articles/${deckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      return readApiResponse<{ id?: string }>(res, 'Failed to update deck');
    },
    onSuccess: (data: { id?: string }) => {
      if (data.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.detail(data.id) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deckId: string) => {
      const res = await fetch(`/api/articles/${deckId}`, {
        method: 'DELETE',
      });

      return readApiResponse(res, 'Failed to delete deck');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workspace', {
        method: 'POST',
      });

      return readApiResponse<WorkspaceCreateResult>(res, 'Failed to create workspace');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace() });
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
}

export function useRecoverWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accessKey: string) => {
      const res = await fetch('/api/workspace/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey }),
      });

      return readApiResponse<WorkspaceRecoveryResult>(res, 'Failed to recover workspace');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace() });
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });
}

export function useCreateSlide(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSlideRequest) => {
      const res = await fetch(`/api/articles/${deckId}/slides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      return readApiResponse<{ id: string }>(res, 'Failed to create slide');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useUpdateSlide(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slideId,
      ...update
    }: SlideUpdateRequest & { slideId: string }) => {
      const res = await fetch(`/api/articles/${deckId}/slides/${slideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      return readApiResponse(res, 'Failed to update slide');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
    },
  });
}

export function useDeleteSlide(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slideId: string) => {
      const res = await fetch(`/api/articles/${deckId}/slides/${slideId}`, {
        method: 'DELETE',
      });

      return readApiResponse(res, 'Failed to delete slide');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useReorderSlides(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slideOrder: Array<{ id: string; order: number }>) => {
      const res = await fetch(`/api/articles/${deckId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideOrder }),
      });

      return readApiResponse(res, 'Failed to reorder slides');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detail(deckId) });
    },
  });
}
