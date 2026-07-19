import { z } from 'zod';

import { createInvitationSecret, hashInvitationToken } from '@/server/domain/invitations';
import { TELEGRAM_APPROVAL_LIFETIME_MS } from '@/server/domain/telegram-authorization';
import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().trim().min(1).max(200);
const CallbackTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export interface TelegramApprovalRepository {
  requestConfirmation(input: {
    approvalId: string;
    actorUserId: string;
    telegramUserId: string;
    commandId: string;
    callbackTokenHash: string;
    requestedExpiresAt: Date;
    now: Date;
  }): Promise<{ commandId: string; expiresAt: Date } | null>;
  confirm(input: {
    actorUserId: string;
    telegramUserId: string;
    callbackTokenHash: string;
    now: Date;
  }): Promise<{ commandId: string } | null>;
  expire(input: {
    actorUserId: string;
    telegramUserId: string;
    callbackTokenHash: string;
    now: Date;
  }): Promise<boolean>;
}

function approvalError(code: string, message: string): AppError {
  return new AppError({ code, message, status: 409 });
}

export async function requestTelegramPublishConfirmation(input: {
  repository: TelegramApprovalRepository;
  actorUserId: string;
  telegramUserId: string;
  commandId: string;
  approvalId?: string;
  entropy?: Uint8Array;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const approvalId = IdentifierSchema.parse(input.approvalId ?? crypto.randomUUID());
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const telegramUserId = IdentifierSchema.parse(input.telegramUserId);
  const commandId = IdentifierSchema.parse(input.commandId);
  const callbackSecret = await createInvitationSecret(input.entropy);
  const requestedExpiresAt = new Date(now.getTime() + TELEGRAM_APPROVAL_LIFETIME_MS);
  const created = await input.repository.requestConfirmation({
    approvalId,
    actorUserId,
    telegramUserId,
    commandId,
    callbackTokenHash: callbackSecret.tokenHash,
    requestedExpiresAt,
    now,
  });
  if (!created) {
    throw approvalError(
      'PUBLISH_APPROVAL_NOT_AVAILABLE',
      'This publication is not available for approval.',
    );
  }
  return {
    callbackToken: callbackSecret.token,
    expiresAt: created.expiresAt,
  };
}

export async function confirmTelegramPublish(input: {
  repository: TelegramApprovalRepository;
  actorUserId: string;
  telegramUserId: string;
  callbackToken: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const telegramUserId = IdentifierSchema.parse(input.telegramUserId);
  const token = CallbackTokenSchema.safeParse(input.callbackToken);
  if (!token.success) {
    throw approvalError('PUBLISH_APPROVAL_INVALID', 'This publish confirmation is invalid or expired.');
  }
  const callbackTokenHash = await hashInvitationToken(token.data);
  const confirmed = await input.repository.confirm({
    actorUserId,
    telegramUserId,
    callbackTokenHash,
    now,
  });
  if (confirmed) return confirmed;

  const expired = await input.repository.expire({
    actorUserId,
    telegramUserId,
    callbackTokenHash,
    now,
  });
  if (expired) {
    throw approvalError('PUBLISH_APPROVAL_EXPIRED', 'This publish confirmation has expired.');
  }
  throw approvalError('PUBLISH_APPROVAL_INVALID', 'This publish confirmation is invalid or expired.');
}
