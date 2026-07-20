// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_GENERATION_INTENT_KEY,
  AnonymousDraftStorageError,
  claimAnonymousGenerationIntent,
  createAnonymousGenerationIntent,
  loadAnonymousGenerationIntent,
  saveAnonymousGenerationIntent,
  updateAnonymousGenerationIntent,
} from './anonymous-draft';

const NOW = Date.parse('2026-07-20T04:00:00.000Z');

function intent() {
  return createAnonymousGenerationIntent({
    intentId: '11111111-1111-4111-8111-111111111111',
    prompt: 'Explain how tokenized gold can trade around the clock.',
    slideCount: 5,
    illustrationStyle: 'lab-notes',
    now: NOW,
  });
}

describe('anonymous generation draft storage', () => {
  it('round-trips a strict tab-scoped intent without sensitive identity or access fields', () => {
    const draft = intent();

    saveAnonymousGenerationIntent(sessionStorage, draft);

    expect(loadAnonymousGenerationIntent(sessionStorage, {
      intentId: draft.intentId,
      now: NOW + 1_000,
    })).toEqual(draft);
    const serialized = sessionStorage.getItem(ANONYMOUS_GENERATION_INTENT_KEY) ?? '';
    expect(Object.keys(JSON.parse(serialized))).not.toEqual(expect.arrayContaining([
      'accessCode', 'token', 'email', 'workspaceId', 'oauthState',
    ]));
  });

  it('rejects expired, mismatched, malformed, or unknown-version records and removes them', () => {
    const draft = intent();
    saveAnonymousGenerationIntent(sessionStorage, draft);

    expect(loadAnonymousGenerationIntent(sessionStorage, {
      intentId: '22222222-2222-4222-8222-222222222222',
      now: NOW,
    })).toBeNull();
    expect(sessionStorage.getItem(ANONYMOUS_GENERATION_INTENT_KEY)).toBeNull();

    sessionStorage.setItem(ANONYMOUS_GENERATION_INTENT_KEY, JSON.stringify({
      ...draft,
      version: 2,
      accessCode: 'gac_secret',
    }));
    expect(loadAnonymousGenerationIntent(sessionStorage, { now: NOW })).toBeNull();
    expect(sessionStorage.getItem(ANONYMOUS_GENERATION_INTENT_KEY)).toBeNull();

    saveAnonymousGenerationIntent(sessionStorage, draft);
    expect(loadAnonymousGenerationIntent(sessionStorage, {
      intentId: draft.intentId,
      now: draft.expiresAt + 1,
    })).toBeNull();
    expect(sessionStorage.getItem(ANONYMOUS_GENERATION_INTENT_KEY)).toBeNull();
  });

  it('claims a submitted intent exactly once before any paid request can resume', () => {
    const draft = { ...intent(), stage: 'submitted' as const };
    saveAnonymousGenerationIntent(sessionStorage, draft);

    const first = claimAnonymousGenerationIntent(sessionStorage, {
      intentId: draft.intentId,
      now: NOW + 1,
    });
    const second = claimAnonymousGenerationIntent(sessionStorage, {
      intentId: draft.intentId,
      now: NOW + 2,
    });

    expect(first).toMatchObject({ stage: 'resuming' });
    expect(second).toBeNull();
    expect(loadAnonymousGenerationIntent(sessionStorage, {
      intentId: draft.intentId,
      now: NOW + 2,
    })).toMatchObject({ stage: 'resuming' });
  });

  it('surfaces storage denial instead of pretending the draft was preserved', () => {
    const deniedStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage;

    expect(() => saveAnonymousGenerationIntent(deniedStorage, intent()))
      .toThrow(AnonymousDraftStorageError);
  });

  it('refreshes the bounded expiry after an edit or submit transition', () => {
    const draft = intent();
    const later = NOW + 10 * 60 * 1_000;
    const updated = updateAnonymousGenerationIntent(sessionStorage, draft, {
      stage: 'submitted',
      prompt: `${draft.prompt} Add a risk section.`,
    }, later);

    expect(updated.updatedAt).toBe(later);
    expect(updated.expiresAt).toBe(later + 60 * 60 * 1_000);
  });

  it('rejects forged lifetimes and incomplete generation checkpoints', () => {
    const draft = intent();
    sessionStorage.setItem(ANONYMOUS_GENERATION_INTENT_KEY, JSON.stringify({
      ...draft,
      updatedAt: draft.createdAt + 1,
      expiresAt: draft.createdAt + 24 * 60 * 60 * 1_000,
    }));
    expect(loadAnonymousGenerationIntent(sessionStorage, { now: NOW })).toBeNull();

    sessionStorage.setItem(ANONYMOUS_GENERATION_INTENT_KEY, JSON.stringify({
      ...draft,
      stage: 'generation_started',
      articleId: '22222222-2222-4222-8222-222222222222',
    }));
    expect(loadAnonymousGenerationIntent(sessionStorage, { now: NOW })).toBeNull();

    sessionStorage.setItem(ANONYMOUS_GENERATION_INTENT_KEY, JSON.stringify({
      ...draft,
      createdAt: NOW + 24 * 60 * 60 * 1_000,
      updatedAt: NOW + 24 * 60 * 60 * 1_000,
      expiresAt: NOW + 25 * 60 * 60 * 1_000,
    }));
    expect(loadAnonymousGenerationIntent(sessionStorage, { now: NOW })).toBeNull();
  });
});
