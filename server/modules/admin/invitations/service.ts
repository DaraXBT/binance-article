import { z } from 'zod';

import {
  INVITATION_LIFETIME_MS,
  createInvitationSecret,
  hashInvitationToken,
} from '@/server/domain/invitations';
import { AppError } from '@/server/http/errors';

export const MAX_ACTIVE_BETA_USERS = 10;

const EmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const IdentifierSchema = z.string().trim().min(1).max(200);
const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);

export interface InvitationListRow {
  id: string;
  email: string;
  tokenPrefix: string;
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationAdminRepository {
  insertWithinCapacity(input: {
    id: string;
    email: string;
    tokenHash: string;
    tokenPrefix: string;
    createdByUserId: string;
    expiresAt: Date;
    now: Date;
  }, capacity: number): Promise<'created' | 'cap_reached' | 'duplicate'>;
  findPendingByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<{ id: string; email: string; expiresAt: Date } | null>;
  list(limit: number): Promise<InvitationListRow[]>;
  revoke(input: {
    invitationId: string;
    actorUserId: string;
    now: Date;
  }): Promise<boolean>;
}

export type InvitationDisplayStatus = InvitationListRow['status'] | 'expired';

export interface InvitationSummary {
  id: string;
  email: string;
  tokenPrefix: string;
  status: InvitationDisplayStatus;
  expiresAt: Date;
  createdAt: Date;
}

function appError(code: string, message: string, status: number) {
  return new AppError({ code, message, status });
}

export async function createInvitation(input: {
  repository: InvitationAdminRepository;
  actorUserId: string;
  email: string;
  now?: Date;
  entropy?: Uint8Array;
  id?: string;
}) {
  const email = EmailSchema.safeParse(input.email);
  if (!email.success) {
    throw appError('INVALID_INVITATION_EMAIL', 'Enter a valid invitation email.', 400);
  }
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const id = IdentifierSchema.parse(input.id ?? crypto.randomUUID());
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
  const secret = await createInvitationSecret(input.entropy);

  const result = await input.repository.insertWithinCapacity({
    id,
    email: email.data,
    tokenHash: secret.tokenHash,
    tokenPrefix: secret.tokenPrefix,
    createdByUserId: actorUserId,
    expiresAt,
    now,
  }, MAX_ACTIVE_BETA_USERS);

  if (result === 'cap_reached') {
    throw appError('BETA_USER_CAP_REACHED', 'The private beta user limit has been reached.', 409);
  }
  if (result === 'duplicate') {
    throw appError('INVITATION_ALREADY_PENDING', 'An active invitation already exists for this email.', 409);
  }

  return { token: secret.token, tokenPrefix: secret.tokenPrefix, expiresAt };
}

export async function inspectInvitation(input: {
  repository: InvitationAdminRepository;
  token: string;
  now?: Date;
}) {
  const token = TokenSchema.safeParse(input.token);
  if (!token.success) throw appError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);

  const invitation = await input.repository.findPendingByHash({
    tokenHash: await hashInvitationToken(token.data),
    now: input.now ?? new Date(),
  });
  if (!invitation) throw appError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);
  return { email: invitation.email };
}

export async function listInvitations(input: {
  repository: InvitationAdminRepository;
  now?: Date;
  limit?: number;
}): Promise<InvitationSummary[]> {
  const now = input.now ?? new Date();
  const rows = await input.repository.list(input.limit ?? 50);
  return rows.map((row) => ({
    ...row,
    // A pending row past its expiry can never be redeemed; surface that
    // instead of leaving operators to compare timestamps.
    status: row.status === 'pending' && row.expiresAt.getTime() <= now.getTime()
      ? 'expired'
      : row.status,
  }));
}

export async function revokeInvitation(input: {
  repository: InvitationAdminRepository;
  invitationId: string;
  actorUserId: string;
  now?: Date;
}) {
  const revoked = await input.repository.revoke({
    invitationId: IdentifierSchema.parse(input.invitationId),
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    now: input.now ?? new Date(),
  });
  if (!revoked) throw appError('INVITATION_NOT_FOUND', 'Invitation not found.', 404);
  return { revoked: true as const };
}
