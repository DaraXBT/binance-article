import { z } from 'zod';

import {
  hashPublicationRecipe,
  publicationRecipeKind,
  publicationRecipeTarget,
  validatePublicationRecipe,
  type PublicationRecipe,
  type PublicationKind,
  type PublicationTarget,
} from '@/server/domain/publication-recipe';
import { transitionPublisherCommand } from '@/server/domain/publisher-command';
import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().trim().min(1).max(200);
const RevisionSchema = z.number().int().positive().safe();
const AbortReasonSchema = z.enum([
  'ASSET_INTEGRITY_FAILED',
  'EDITOR_COMPOSITION_FAILED',
  'EDITOR_CLOSED',
  'RECIPE_INVALID',
  'DEVICE_SHUTDOWN',
  'USER_CANCELLED',
  'X_LOGIN_REQUIRED',
  'X_ARTICLES_UNAVAILABLE',
]);

type CommandState =
  | 'queued'
  | 'claimed'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'approved'
  | 'publishing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'outcome_unknown';

export interface PublisherCommandRecord {
  id: string;
  draftId: string;
  deviceId: string | null;
  state: CommandState;
  revision: number;
  recipeHash: string;
  expiresAt: Date;
  target?: PublicationTarget;
  kind?: PublicationKind;
}

export interface PublisherCommandRepository {
  claimNext(input: { deviceId: string; now: Date }): Promise<PublisherCommandRecord | null>;
  loadRecipe(input: {
    deviceId: string;
    commandId: string;
  }): Promise<{
    command: Pick<
      PublisherCommandRecord,
      'id' | 'deviceId' | 'state' | 'revision' | 'recipeHash' | 'target' | 'kind'
    >;
    recipe: unknown;
  } | null>;
  compareAndSwap(input: {
    commandId: string;
    deviceId: string;
    revision: number;
    from: CommandState;
    to: CommandState;
    now: Date;
    publishedUrl?: string;
    failureReason?: string;
  }): Promise<boolean>;
  loadStatus(input: {
    deviceId: string;
    commandId: string;
  }): Promise<PublisherCommandRecord | null>;
  abort(input: {
    commandId: string;
    deviceId: string;
    revision: number;
    reasonCode: z.infer<typeof AbortReasonSchema>;
    now: Date;
  }): Promise<boolean>;
}

function commandError(code: string, message: string, status = 409): AppError {
  return new AppError({ code, message, status });
}

function constantTimeHashEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function claimNextPublisherCommand(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  now?: Date;
}) {
  return input.repository.claimNext({
    deviceId: IdentifierSchema.parse(input.deviceId),
    now: input.now ?? new Date(),
  });
}

export async function loadPublisherRecipe(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  now?: Date;
}): Promise<PublicationRecipe> {
  const deviceId = IdentifierSchema.parse(input.deviceId);
  const commandId = IdentifierSchema.parse(input.commandId);
  const loaded = await input.repository.loadRecipe({ deviceId, commandId });
  if (!loaded || loaded.command.deviceId !== deviceId) {
    throw commandError('PUBLISHER_COMMAND_NOT_FOUND', 'Publisher command not found.', 404);
  }
  if (!['claimed', 'awaiting_review', 'awaiting_approval', 'approved'].includes(loaded.command.state)) {
    throw commandError('PUBLISHER_COMMAND_STALE', 'Publisher command is no longer available.');
  }

  const recipe = validatePublicationRecipe(loaded.recipe, {
    now: input.now ?? new Date(),
    expectedRevision: loaded.command.revision,
  });
  if (publicationRecipeTarget(recipe) !== (loaded.command.target ?? 'binance-square')) {
    throw commandError('PUBLICATION_RECIPE_MISMATCH', 'Publication recipe target verification failed.');
  }
  const legacyKind = (loaded.command.target ?? 'binance-square') === 'x' ? 'post' : 'article';
  if (publicationRecipeKind(recipe) !== (loaded.command.kind ?? legacyKind)) {
    throw commandError('PUBLICATION_RECIPE_MISMATCH', 'Publication recipe kind verification failed.');
  }
  const actualHash = await hashPublicationRecipe(recipe);
  if (!constantTimeHashEqual(actualHash, loaded.command.recipeHash)) {
    throw commandError('PUBLICATION_RECIPE_MISMATCH', 'Publication recipe verification failed.');
  }
  return recipe;
}

async function transition(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  revision: number;
  from: CommandState;
  to: CommandState;
  now?: Date;
  publishedUrl?: string;
  failureReason?: string;
}) {
  const swapped = await input.repository.compareAndSwap({
    commandId: IdentifierSchema.parse(input.commandId),
    deviceId: IdentifierSchema.parse(input.deviceId),
    revision: RevisionSchema.parse(input.revision),
    from: input.from,
    to: input.to,
    now: input.now ?? new Date(),
    ...(input.publishedUrl ? { publishedUrl: input.publishedUrl } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  });
  if (!swapped) throw commandError('PUBLISHER_COMMAND_STALE', 'Publisher command state changed.');
  return { state: input.to };
}

export function reportEditorReady(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  revision: number;
  now?: Date;
}) {
  return transition({ ...input, from: 'claimed', to: 'awaiting_review' });
}

export function beginDevicePublish(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  revision: number;
  now?: Date;
}) {
  return transition({ ...input, from: 'approved', to: 'publishing' });
}

export async function reportPublishResult(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  revision: number;
  outcome: 'succeeded' | 'failed' | 'outcome_unknown';
  publishedUrl?: string;
  failureReason?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const deviceId = IdentifierSchema.parse(input.deviceId);
  const commandId = IdentifierSchema.parse(input.commandId);
  const revision = RevisionSchema.parse(input.revision);
  const command = await input.repository.loadStatus({ deviceId, commandId });
  if (
    !command
    || command.deviceId !== deviceId
    || command.revision !== revision
    || command.state !== 'publishing'
  ) {
    throw commandError('PUBLISHER_COMMAND_STALE', 'Publisher command state changed.');
  }
  const base = {
    state: 'publishing' as const,
    revision,
    target: command.target ?? 'binance-square',
    ...(command.kind ? { kind: command.kind } : {}),
    assignedDeviceId: deviceId,
    expiresAt: new Date(now.getTime() + 1),
  };

  if (input.outcome === 'succeeded') {
    transitionPublisherCommand(base, {
      type: 'publish_succeeded',
      deviceId: input.deviceId,
      revision: input.revision,
      publishedUrl: input.publishedUrl ?? '',
    }, now);
  } else if (input.outcome === 'failed') {
    transitionPublisherCommand(base, {
      type: 'publish_failed',
      deviceId: input.deviceId,
      revision: input.revision,
      failureReason: input.failureReason ?? 'Publisher reported a failure.',
    }, now);
  } else {
    transitionPublisherCommand(base, {
      type: 'publish_outcome_unknown',
      deviceId: input.deviceId,
      revision: input.revision,
      failureReason: input.failureReason ?? 'Publisher could not verify the final outcome.',
    }, now);
  }

  return transition({
    ...input,
    from: 'publishing',
    to: input.outcome,
    now,
  });
}

const EXPIRABLE_STATES = new Set<CommandState>([
  'queued',
  'claimed',
  'awaiting_review',
  'awaiting_approval',
  'approved',
]);

export async function getPublisherCommandStatus(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  now?: Date;
}) {
  const deviceId = IdentifierSchema.parse(input.deviceId);
  const commandId = IdentifierSchema.parse(input.commandId);
  let command = await input.repository.loadStatus({ deviceId, commandId });
  if (!command || command.deviceId !== deviceId) {
    throw commandError('PUBLISHER_COMMAND_NOT_FOUND', 'Publisher command not found.', 404);
  }
  const now = input.now ?? new Date();
  if (command.expiresAt.getTime() <= now.getTime() && EXPIRABLE_STATES.has(command.state)) {
    const expired = await input.repository.compareAndSwap({
      commandId,
      deviceId,
      revision: command.revision,
      from: command.state,
      to: 'expired',
      now,
    });
    if (expired) {
      command = { ...command, state: 'expired' };
    } else {
      const current = await input.repository.loadStatus({ deviceId, commandId });
      if (!current || current.deviceId !== deviceId) {
        throw commandError('PUBLISHER_COMMAND_NOT_FOUND', 'Publisher command not found.', 404);
      }
      command = current;
    }
  }
  return {
    id: command.id,
    target: command.target ?? 'binance-square',
    ...(command.kind ? { kind: command.kind } : {}),
    state: command.state,
    revision: command.revision,
    recipeHash: command.recipeHash,
    expiresAt: command.expiresAt,
  };
}

export async function abortPublisherCommand(input: {
  repository: PublisherCommandRepository;
  deviceId: string;
  commandId: string;
  revision: number;
  reasonCode: unknown;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const aborted = await input.repository.abort({
    deviceId: IdentifierSchema.parse(input.deviceId),
    commandId: IdentifierSchema.parse(input.commandId),
    revision: RevisionSchema.parse(input.revision),
    reasonCode: AbortReasonSchema.parse(input.reasonCode),
    now,
  });
  if (!aborted) throw commandError('PUBLISHER_COMMAND_STALE', 'Publisher command state changed.');
  return { state: 'cancelled' as const };
}
