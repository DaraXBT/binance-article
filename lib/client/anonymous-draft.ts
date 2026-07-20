import { z } from 'zod';

import { IllustrationStyleSchema } from '@/lib/schemas';

export const ANONYMOUS_GENERATION_INTENT_KEY = 'xarticle:anonymous-generation-intent:v1';
export const ANONYMOUS_GENERATION_INTENT_TTL_MS = 60 * 60 * 1_000;

const SlideCountSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(10),
  z.literal(15),
]);

const IntentStageSchema = z.enum([
  'editing',
  'submitted',
  'resuming',
  'article_created',
  'generation_started',
  'needs_retry',
]);

export const AnonymousGenerationIntentSchema = z.object({
  version: z.literal(1),
  intentId: z.string().uuid(),
  action: z.literal('generate'),
  stage: IntentStageSchema,
  prompt: z.string().min(1).max(50_000),
  slideCount: SlideCountSchema,
  illustrationStyle: IllustrationStyleSchema,
  articleId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict().superRefine((intent, context) => {
  if (intent.updatedAt < intent.createdAt) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'Draft update time precedes creation.',
    });
  }
  if (
    intent.expiresAt <= intent.updatedAt ||
    intent.expiresAt > intent.updatedAt + ANONYMOUS_GENERATION_INTENT_TTL_MS
  ) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Draft expiry is outside the bounded lifetime.',
    });
  }
  if (intent.jobId && !intent.articleId) {
    context.addIssue({
      code: 'custom',
      path: ['jobId'],
      message: 'A generation job requires an article checkpoint.',
    });
  }
  if (intent.stage === 'article_created' && !intent.articleId) {
    context.addIssue({
      code: 'custom',
      path: ['articleId'],
      message: 'The article checkpoint is missing.',
    });
  }
  if (
    intent.stage === 'generation_started' &&
    (!intent.articleId || !intent.jobId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['jobId'],
      message: 'The generation checkpoint is incomplete.',
    });
  }
});

export type AnonymousGenerationIntent = z.infer<typeof AnonymousGenerationIntentSchema>;

export class AnonymousDraftStorageError extends Error {
  constructor(message = 'This browser could not preserve the draft in this tab.') {
    super(message);
    this.name = 'AnonymousDraftStorageError';
  }
}

function storageFailure(): AnonymousDraftStorageError {
  return new AnonymousDraftStorageError();
}

function removeStoredIntent(storage: Storage): void {
  try {
    storage.removeItem(ANONYMOUS_GENERATION_INTENT_KEY);
  } catch {
    throw storageFailure();
  }
}

export function createAnonymousGenerationIntent(input: {
  intentId?: string;
  prompt: string;
  slideCount: 1 | 3 | 5 | 7 | 10 | 15;
  illustrationStyle: z.infer<typeof IllustrationStyleSchema>;
  stage?: AnonymousGenerationIntent['stage'];
  now?: number;
}): AnonymousGenerationIntent {
  const now = input.now ?? Date.now();
  return AnonymousGenerationIntentSchema.parse({
    version: 1,
    intentId: input.intentId ?? crypto.randomUUID(),
    action: 'generate',
    stage: input.stage ?? 'editing',
    prompt: input.prompt,
    slideCount: input.slideCount,
    illustrationStyle: input.illustrationStyle,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ANONYMOUS_GENERATION_INTENT_TTL_MS,
  });
}

export function saveAnonymousGenerationIntent(
  storage: Storage,
  intent: AnonymousGenerationIntent,
): void {
  const validated = AnonymousGenerationIntentSchema.parse(intent);
  try {
    storage.setItem(ANONYMOUS_GENERATION_INTENT_KEY, JSON.stringify(validated));
  } catch {
    throw storageFailure();
  }
}

export function loadAnonymousGenerationIntent(
  storage: Storage,
  options: { intentId?: string; now?: number } = {},
): AnonymousGenerationIntent | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(ANONYMOUS_GENERATION_INTENT_KEY);
  } catch {
    throw storageFailure();
  }
  if (!serialized) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    removeStoredIntent(storage);
    return null;
  }

  const parsed = AnonymousGenerationIntentSchema.safeParse(raw);
  const now = options.now ?? Date.now();
  const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
  if (
    !parsed.success ||
    parsed.data.createdAt > now + MAX_CLOCK_SKEW_MS ||
    parsed.data.updatedAt > now + MAX_CLOCK_SKEW_MS ||
    parsed.data.expiresAt <= now ||
    (options.intentId !== undefined && parsed.data.intentId !== options.intentId)
  ) {
    removeStoredIntent(storage);
    return null;
  }
  return parsed.data;
}

export function updateAnonymousGenerationIntent(
  storage: Storage,
  intent: AnonymousGenerationIntent,
  update: Partial<Pick<
    AnonymousGenerationIntent,
    'stage' | 'prompt' | 'slideCount' | 'illustrationStyle' | 'articleId' | 'jobId'
  >>,
  now = Date.now(),
): AnonymousGenerationIntent {
  const updated = AnonymousGenerationIntentSchema.parse({
    ...intent,
    ...update,
    updatedAt: now,
    // The draft is kept alive from the latest user-visible transition. This
    // prevents a long editing or sign-in detour from expiring an otherwise
    // active intent while retaining a bounded tab-scoped lifetime.
    expiresAt: now + ANONYMOUS_GENERATION_INTENT_TTL_MS,
  });
  saveAnonymousGenerationIntent(storage, updated);
  return updated;
}

export function claimAnonymousGenerationIntent(
  storage: Storage,
  options: { intentId: string; now?: number },
): AnonymousGenerationIntent | null {
  const intent = loadAnonymousGenerationIntent(storage, options);
  if (!intent || intent.stage !== 'submitted') return null;
  return updateAnonymousGenerationIntent(
    storage,
    intent,
    { stage: 'resuming' },
    options.now ?? Date.now(),
  );
}

export function removeAnonymousGenerationIntent(storage: Storage): void {
  removeStoredIntent(storage);
}
