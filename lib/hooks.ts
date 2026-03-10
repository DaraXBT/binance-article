'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  CreateSlideRequest,
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
};

export type WorkspaceCreateResult = {
  success: true;
  workspaceId: string;
  accessKeyPrefix: string;
  recoveryKey: string | null;
};

export type WorkspaceRecoveryResult = {
  success: true;
  workspaceId: string;
  accessKeyPrefix: string;
};

async function readApiResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || fallbackMessage);
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
};

async function fetchDecks() {
  const res = await fetch('/api/articles');
  return readApiResponse(res, 'Failed to fetch decks');
}

async function fetchDeck(id: string) {
  const res = await fetch(`/api/articles/${id}`);
  return readApiResponse(res, 'Failed to fetch deck');
}

async function fetchJob(jobId: string) {
  const res = await fetch(`/api/jobs/${jobId}`);
  return readApiResponse(res, 'Failed to fetch job');
}

async function fetchWorkspace() {
  const res = await fetch('/api/workspace');
  return readApiResponse<WorkspaceBootstrap>(res, 'Failed to fetch workspace');
}

export function useDecks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchDecks,
    staleTime: 30000,
    enabled,
  });
}

export function useDeck(id: string) {
  return useQuery({
    queryKey: queryKeys.detail(id),
    queryFn: () => fetchDeck(id),
    staleTime: 10000,
    enabled: Boolean(id),
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
  return useQuery({
    queryKey: queryKeys.workspace(),
    queryFn: fetchWorkspace,
    staleTime: 30000,
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
