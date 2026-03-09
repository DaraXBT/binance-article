'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DeckGenerateRequest, SlideUpdateRequest } from './schemas';

// Query key factory
export const queryKeys = {
  all: ['decks'] as const,
  lists: () => [...queryKeys.all, 'list'] as const,
  detail: (id: string) => [...queryKeys.all, 'detail', id] as const,
  jobs: () => [...queryKeys.all, 'jobs'] as const,
  job: (id: string) => [...queryKeys.jobs(), id] as const,
};

// Fetch functions
async function fetchDecks() {
  const res = await fetch('/api/decks');
  if (!res.ok) throw new Error('Failed to fetch decks');
  return res.json();
}

async function fetchDeck(id: string) {
  const res = await fetch(`/api/decks/${id}`);
  if (!res.ok) throw new Error('Failed to fetch deck');
  return res.json();
}

async function fetchJob(jobId: string) {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error('Failed to fetch job');
  return res.json();
}

// Hooks for queries
export function useDecks() {
  return useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchDecks,
    staleTime: 30000,
  });
}

export function useDeck(id: string) {
  return useQuery({
    queryKey: queryKeys.detail(id),
    queryFn: () => fetchDeck(id),
    staleTime: 10000,
  });
}

export function useJob(jobId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => fetchJob(jobId),
    refetchInterval: 1000, // Poll every second
    enabled,
  });
}

// Hooks for mutations
export function useCreateDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { title: string; content: string; description?: string }) => {
      const res = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create deck');
      return res.json();
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
      const res = await fetch(`/api/decks/${deckId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to generate deck');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.deckId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.detail(data.deckId),
        });
      }
    },
  });
}

export function useRenderDeck() {
  return useMutation({
    mutationFn: async (deckId: string) => {
      const res = await fetch(`/api/decks/${deckId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to start render job');
      return res.json();
    },
  });
}

export function useUpdateDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      deckId,
      ...data
    }: {
      deckId: string;
      title?: string;
      description?: string;
      theme?: string;
      status?: string;
    }) => {
      const res = await fetch(`/api/decks/${deckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update deck');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.detail(data.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deckId: string) => {
      const res = await fetch(`/api/decks/${deckId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete deck');
      return res.json();
    },
    onSuccess: () => {
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
      const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Failed to update slide');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.detail(deckId),
      });
    },
  });
}

export function useDeleteSlide(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slideId: string) => {
      const res = await fetch(`/api/decks/${deckId}/slides/${slideId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete slide');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.detail(deckId),
      });
    },
  });
}

export function useReorderSlides(deckId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slideOrder: Array<{ id: string; order: number }>) => {
      const res = await fetch(`/api/decks/${deckId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideOrder }),
      });
      if (!res.ok) throw new Error('Failed to reorder slides');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.detail(deckId),
      });
    },
  });
}
