import { z } from 'zod';

import { PublicationTargetSchema, type PublicationTarget } from '@/server/domain/publication-recipe';
import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const RevisionSchema = z.number().int().positive().safe();
const RecipeHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export interface WebPublisherCommand {
  id: string;
  draftId: string;
  target: PublicationTarget;
  state: string;
  revision: number;
  recipeHash: string;
  expiresAt: Date;
  resultUrl?: string | null;
  failureReason?: string | null;
  updatedAt?: Date;
}

export interface WebPublishApprovalRepository {
  loadCommand(input: {
    actorUserId: string;
    commandId: string;
  }): Promise<WebPublisherCommand | null>;
  approve(input: {
    approvalId: string;
    actorUserId: string;
    commandId: string;
    revision: number;
    recipeHash: string;
    now: Date;
  }): Promise<WebPublisherCommand | null>;
  cancel(input: {
    actorUserId: string;
    commandId: string;
    revision: number;
    recipeHash: string;
    now: Date;
  }): Promise<WebPublisherCommand | null>;
  expire(input: {
    actorUserId: string;
    commandId: string;
    now: Date;
  }): Promise<WebPublisherCommand | null>;
}

function notFound(): AppError {
  return new AppError({
    code: 'PUBLISHER_COMMAND_NOT_FOUND',
    message: 'Publisher command not found.',
    status: 404,
  });
}

function serialize(command: WebPublisherCommand) {
  return {
    id: IdentifierSchema.parse(command.id),
    draftId: IdentifierSchema.parse(command.draftId),
    target: PublicationTargetSchema.parse(command.target),
    state: z.enum([
      'queued', 'claimed', 'awaiting_review', 'awaiting_approval', 'approved', 'publishing',
      'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
    ]).parse(command.state),
    revision: RevisionSchema.parse(command.revision),
    recipeHash: RecipeHashSchema.parse(command.recipeHash),
    expiresAt: command.expiresAt,
    ...(command.resultUrl ? { publishedUrl: z.string().url().parse(command.resultUrl) } : {}),
    ...(command.failureReason ? { failureReason: command.failureReason } : {}),
    ...(command.updatedAt ? { updatedAt: command.updatedAt } : {}),
  };
}

export async function getWebPublisherCommand(input: {
  repository: WebPublishApprovalRepository;
  actorUserId: string;
  commandId: string;
  now?: Date;
}) {
  const command = await input.repository.loadCommand({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    commandId: IdentifierSchema.parse(input.commandId),
  });
  if (!command) throw notFound();
  const value = serialize(command);
  const now = input.now ?? new Date();
  if (
    value.expiresAt.getTime() <= now.getTime()
    && ['queued', 'claimed', 'awaiting_review', 'awaiting_approval', 'approved'].includes(value.state)
  ) {
    const expired = await input.repository.expire({
      actorUserId: IdentifierSchema.parse(input.actorUserId),
      commandId: IdentifierSchema.parse(input.commandId),
      now,
    });
    if (expired) return serialize(expired);

    const current = await input.repository.loadCommand({
      actorUserId: IdentifierSchema.parse(input.actorUserId),
      commandId: IdentifierSchema.parse(input.commandId),
    });
    if (!current) throw notFound();
    return serialize(current);
  }
  return value;
}

export async function cancelWebPublication(input: {
  repository: WebPublishApprovalRepository;
  actorUserId: string;
  commandId: string;
  revision: unknown;
  recipeHash: unknown;
  confirmed: unknown;
  now?: Date;
}) {
  if (input.confirmed !== true) {
    throw new AppError({
      code: 'PUBLISH_CANCELLATION_CONFIRMATION_REQUIRED',
      message: 'Explicit publication cancellation is required.',
      status: 400,
    });
  }
  const cancelled = await input.repository.cancel({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    commandId: IdentifierSchema.parse(input.commandId),
    revision: RevisionSchema.parse(input.revision),
    recipeHash: RecipeHashSchema.parse(input.recipeHash),
    now: input.now ?? new Date(),
  });
  if (!cancelled) {
    throw new AppError({
      code: 'PUBLISH_CANCELLATION_STALE',
      message: 'The publisher command changed and could not be cancelled.',
      status: 409,
    });
  }
  return serialize(cancelled);
}

export async function approveWebPublication(input: {
  repository: WebPublishApprovalRepository;
  actorUserId: string;
  commandId: string;
  revision: unknown;
  recipeHash: unknown;
  confirmed: unknown;
  approvalId?: string;
  now?: Date;
}) {
  if (input.confirmed !== true) {
    throw new AppError({
      code: 'PUBLISH_CONFIRMATION_REQUIRED',
      message: 'Explicit publication confirmation is required.',
      status: 400,
    });
  }
  const now = input.now ?? new Date();
  const approved = await input.repository.approve({
    approvalId: IdentifierSchema.parse(input.approvalId ?? crypto.randomUUID()),
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    commandId: IdentifierSchema.parse(input.commandId),
    revision: RevisionSchema.parse(input.revision),
    recipeHash: RecipeHashSchema.parse(input.recipeHash),
    now,
  });
  if (!approved) {
    throw new AppError({
      code: 'PUBLISH_APPROVAL_STALE',
      message: 'The publisher command changed. Review the prepared composer again.',
      status: 409,
    });
  }
  return serialize(approved);
}
