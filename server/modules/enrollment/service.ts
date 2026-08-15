import { z } from 'zod';

import { hashInvitationToken } from '@/server/domain/invitations';
import { AppError } from '@/server/http/errors';

import {
  ENROLLMENT_CLAIM_TTL_MS,
  ENROLLMENT_RESERVATION_LEASE_MS,
  MAX_ACTIVE_ENROLLMENT_USERS,
  createEnrollmentClaimToken,
  createEnrollmentCode,
  deriveEnrollmentClaimToken,
  hashEnrollmentClaimToken,
  hashEnrollmentCode,
  normalizeEnrollmentCode,
} from './domain';

export {
  ENROLLMENT_CLAIM_TTL_MS,
  ENROLLMENT_RESERVATION_LEASE_MS,
  MAX_ACTIVE_ENROLLMENT_USERS,
} from './domain';

export type EnrollmentCodeStatus = 'active' | 'revoked';
export type EnrollmentClaimSource = 'shared_code' | 'legacy_invitation' | 'bootstrap';
export type EnrollmentClaimStatus = 'pending' | 'reserved' | 'completed' | 'expired' | 'revoked';

export interface EnrollmentCodeRecord {
  id: string;
  version: number;
  codePrefix: string;
  status: EnrollmentCodeStatus;
}

export interface EnrollmentClaimRecord {
  id: string;
  codeId: string | null;
  codeVersion: number | null;
  source: EnrollmentClaimSource;
  status: EnrollmentClaimStatus;
  email: string | null;
  userId: string | null;
  expiresAt: Date;
  reservationExpiresAt: Date | null;
}

export interface EnrollmentClaimRepository {
  findActiveCodeByHash(input: {
    codeHash: string;
    now: Date;
  }): Promise<EnrollmentCodeRecord | null>;
  createClaim(input: {
    id: string;
    tokenHash: string;
    tokenPrefix: string;
    codeId: string;
    codeVersion: number;
    source: 'shared_code';
    idempotencyKeyHash: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<EnrollmentClaimRecord | null>;
}

export interface LegacyEnrollmentClaimRepository {
  createLegacyClaim(input: {
    id: string;
    tokenHash: string;
    tokenPrefix: string;
    invitationTokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<EnrollmentClaimRecord | null>;
}

export type ReserveEnrollmentClaimResult =
  | { outcome: 'reserved' | 'already_reserved'; claimId: string }
  | { outcome: 'existing_user'; claimId: string; userId: string }
  | { outcome: 'capacity_full' | 'email_mismatch' | 'user_disabled' | 'invalid' };

export interface EnrollmentReservationRepository {
  reserveClaim(input: {
    claimTokenHash: string;
    email: string;
    capacity: number;
    reservationExpiresAt: Date;
    now: Date;
  }): Promise<ReserveEnrollmentClaimResult>;
}

export type CompleteEnrollmentClaimResult =
  | {
    outcome: 'completed' | 'already_completed';
    claimId: string;
    workspaceId?: string;
  }
  | { outcome: 'capacity_full' | 'identity_mismatch' | 'invalid' };

export interface EnrollmentCompletionRepository {
  completeClaim(input: {
    claimTokenHash: string;
    userId: string;
    workspaceId: string;
    workspaceAccessKeyHash: string;
    workspaceAccessKeyPrefix: string;
    auditEventId: string;
    capacity: number;
    now: Date;
  }): Promise<CompleteEnrollmentClaimResult>;
  releaseClaim(input: {
    claimTokenHash: string;
    email: string;
    now: Date;
  }): Promise<boolean>;
}

export interface EnrollmentCodeRotationRepository {
  createCode(input: {
    codeId: string;
    codeHash: string;
    codePrefix: string;
    actorUserId: string;
    auditEventId: string;
    now: Date;
  }): Promise<{ outcome: 'created'; version: number } | { outcome: 'active_exists' }>;
  rotateCode(input: {
    codeId: string;
    codeHash: string;
    codePrefix: string;
    actorUserId: string;
    auditEventId: string;
    reason: string;
    now: Date;
  }): Promise<{
    version: number;
    revokedCodeId: string | null;
    revokedClaims: number;
  }>;
}

export interface EnrollmentCodeRevocationRepository {
  revokeCode(input: {
    actorUserId: string;
    auditEventId: string;
    reason: string;
    now: Date;
  }): Promise<
    | { outcome: 'revoked'; revokedCodeId: string; revokedClaims: number }
    | { outcome: 'no_active_code' }
  >;
}

export interface EnrollmentRepository extends
  EnrollmentClaimRepository,
  LegacyEnrollmentClaimRepository,
  EnrollmentReservationRepository,
  EnrollmentCompletionRepository,
  EnrollmentCodeRotationRepository,
  EnrollmentCodeRevocationRepository {}

const IdentifierSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const EmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const IdempotencyKeySchema = z.string().trim().min(8).max(200);
const RotationReasonSchema = z.string().trim().min(1).max(200);

function appError(code: string, message: string, status: number): AppError {
  return new AppError({ code, message, status });
}

function invalidCode(): AppError {
  return appError('INVALID_ENROLLMENT_CODE', 'The enrollment code is invalid or no longer available.', 400);
}

function invalidClaim(): AppError {
  return appError('INVALID_ENROLLMENT_CLAIM', 'The enrollment attempt is invalid or no longer available.', 400);
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Enrollment timestamp is invalid.');
  return now;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : globalThis.Buffer.from(bytes).toString('base64');
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function legacyClaimToken(invitationToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`xarticle:legacy-enrollment-claim:v1:${invitationToken}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function claimTokenHash(token: string): Promise<string> {
  try {
    return await hashEnrollmentClaimToken(token);
  } catch {
    throw invalidClaim();
  }
}

export function getEnrollmentCodePepper(
  environment: Record<string, string | undefined> = process.env,
): string {
  const pepper = environment.ENROLLMENT_CODE_PEPPER?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error('ENROLLMENT_CODE_PEPPER must contain at least 32 characters.');
  }
  return pepper;
}

/** Exchange a reusable shared code for a single short-lived opaque claim. */
export async function claimEnrollmentCode(input: {
  repository: EnrollmentClaimRepository;
  code: string;
  pepper: string;
  idempotencyKey?: string;
  id?: string;
  claimEntropy?: Uint8Array;
  now?: Date;
}): Promise<{
  claimId: string;
  claimToken: string;
  status: 'pending';
  expiresAt: Date;
}> {
  let normalizedCode: string;
  try {
    normalizedCode = normalizeEnrollmentCode(input.code);
  } catch {
    throw invalidCode();
  }
  const now = validNow(input.now);
  const codeHash = await hashEnrollmentCode(normalizedCode, input.pepper);
  const activeCode = await input.repository.findActiveCodeByHash({ codeHash, now });
  if (!activeCode || activeCode.status !== 'active') throw invalidCode();

  const idempotencyKey = input.idempotencyKey === undefined
    ? null
    : IdempotencyKeySchema.parse(input.idempotencyKey);
  const claimToken = input.claimEntropy
    ? createEnrollmentClaimToken(input.claimEntropy)
    : idempotencyKey
      ? await deriveEnrollmentClaimToken({
        code: normalizedCode,
        idempotencyKey,
        pepper: input.pepper,
      })
      : createEnrollmentClaimToken();
  const id = IdentifierSchema.parse(input.id ?? crypto.randomUUID());
  const expiresAt = new Date(now.getTime() + ENROLLMENT_CLAIM_TTL_MS);
  const idempotencyKeyHash = idempotencyKey === null
    ? null
    : await sha256Hex(
      `xarticle:enrollment-idempotency:v1:${activeCode.id}:${activeCode.version}:${idempotencyKey}`,
    );
  const claim = await input.repository.createClaim({
    id,
    tokenHash: await hashEnrollmentClaimToken(claimToken),
    tokenPrefix: claimToken.slice(0, 8),
    codeId: activeCode.id,
    codeVersion: activeCode.version,
    source: 'shared_code',
    idempotencyKeyHash,
    expiresAt,
    now,
  });
  if (!claim || (claim.status !== 'pending' && claim.status !== 'reserved')) throw invalidCode();

  return { claimId: claim.id, claimToken, status: 'pending', expiresAt: claim.expiresAt };
}

/** Exchange a temporary email-bound invitation for the durable claim flow. */
export async function claimLegacyInvitation(input: {
  repository: LegacyEnrollmentClaimRepository;
  invitationToken: string;
  id?: string;
  now?: Date;
}): Promise<{
  claimId: string;
  claimToken: string;
  status: 'pending';
  email: string;
  expiresAt: Date;
}> {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(input.invitationToken)) throw invalidCode();
  const now = validNow(input.now);
  const claimToken = await legacyClaimToken(input.invitationToken);
  const claim = await input.repository.createLegacyClaim({
    id: IdentifierSchema.parse(input.id ?? crypto.randomUUID()),
    tokenHash: await hashEnrollmentClaimToken(claimToken),
    tokenPrefix: claimToken.slice(0, 8),
    invitationTokenHash: await hashInvitationToken(input.invitationToken),
    expiresAt: new Date(now.getTime() + ENROLLMENT_CLAIM_TTL_MS),
    now,
  });
  if (!claim || (claim.status !== 'pending' && claim.status !== 'reserved') || !claim.email) {
    throw appError('INVALID_INVITATION', 'The invitation is invalid or expired.', 400);
  }
  return {
    claimId: claim.id,
    claimToken,
    status: 'pending',
    email: claim.email,
    expiresAt: claim.expiresAt,
  };
}

/** Bind the claim to the verified Google email while reserving beta capacity. */
export async function reserveEnrollmentClaim(input: {
  repository: EnrollmentReservationRepository;
  claimToken: string;
  email: string;
  capacity?: number;
  now?: Date;
}): Promise<
  | { reserved: true; replayed: boolean; claimId: string }
  | { reserved: false; existingUser: true; claimId: string; userId: string }
> {
  const now = validNow(input.now);
  const capacity = input.capacity ?? MAX_ACTIVE_ENROLLMENT_USERS;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) {
    throw new Error('Enrollment capacity is invalid.');
  }
  const result = await input.repository.reserveClaim({
    claimTokenHash: await claimTokenHash(input.claimToken),
    email: EmailSchema.parse(input.email),
    capacity,
    reservationExpiresAt: new Date(now.getTime() + ENROLLMENT_RESERVATION_LEASE_MS),
    now,
  });

  if (result.outcome === 'reserved' || result.outcome === 'already_reserved') {
    return { reserved: true, replayed: result.outcome === 'already_reserved', claimId: result.claimId };
  }
  if (result.outcome === 'existing_user') {
    return { reserved: false, existingUser: true, claimId: result.claimId, userId: result.userId };
  }
  if (result.outcome === 'capacity_full') {
    throw appError('BETA_USER_CAP_REACHED', 'The private beta user limit has been reached.', 409);
  }
  if (result.outcome === 'email_mismatch') {
    throw appError('ENROLLMENT_IDENTITY_MISMATCH', 'Continue with the Google identity used to start enrollment.', 403);
  }
  if (result.outcome === 'user_disabled') {
    throw appError('ACCOUNT_DISABLED', 'This account is not allowed to enroll.', 403);
  }
  throw invalidClaim();
}

/**
 * Complete a reserved claim.  The repository owns the atomic activation,
 * workspace membership, claim transition, and audit insert.
 */
export async function completeEnrollmentClaim(input: {
  repository: EnrollmentCompletionRepository;
  claimToken: string;
  userId: string;
  workspaceId?: string;
  workspaceEntropy?: Uint8Array;
  auditEventId?: string;
  capacity?: number;
  now?: Date;
}): Promise<{
  completed: true;
  replayed: boolean;
  claimId: string;
  workspaceId?: string;
}> {
  const now = validNow(input.now);
  const userId = IdentifierSchema.parse(input.userId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId ?? crypto.randomUUID());
  const auditEventId = IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID());
  const workspaceEntropy = input.workspaceEntropy ?? crypto.getRandomValues(new Uint8Array(32));
  if (!(workspaceEntropy instanceof Uint8Array) || workspaceEntropy.byteLength !== 32) {
    throw new Error('Workspace entropy must contain 32 bytes.');
  }
  const capacity = input.capacity ?? MAX_ACTIVE_ENROLLMENT_USERS;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) {
    throw new Error('Enrollment capacity is invalid.');
  }
  const workspaceAccessKeyHash = await sha256Hex(workspaceEntropy);
  const result = await input.repository.completeClaim({
    claimTokenHash: await claimTokenHash(input.claimToken),
    userId,
    workspaceId,
    workspaceAccessKeyHash,
    workspaceAccessKeyPrefix: `acct_${workspaceAccessKeyHash.slice(0, 8)}`,
    auditEventId,
    capacity,
    now,
  });

  if (result.outcome === 'completed' || result.outcome === 'already_completed') {
    return {
      completed: true,
      replayed: result.outcome === 'already_completed',
      claimId: result.claimId,
      ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
    };
  }
  if (result.outcome === 'capacity_full') {
    throw appError('BETA_USER_CAP_REACHED', 'The private beta user limit has been reached.', 409);
  }
  if (result.outcome === 'identity_mismatch') {
    throw appError('ENROLLMENT_IDENTITY_MISMATCH', 'This enrollment claim belongs to another account.', 403);
  }
  throw invalidClaim();
}

export async function releaseEnrollmentClaim(input: {
  repository: Pick<EnrollmentCompletionRepository, 'releaseClaim'>;
  claimToken: string;
  email: string;
  now?: Date;
}): Promise<{ released: boolean }> {
  const now = validNow(input.now);
  return {
    released: await input.repository.releaseClaim({
      claimTokenHash: await claimTokenHash(input.claimToken),
      email: EmailSchema.parse(input.email),
      now,
    }),
  };
}

export async function createInitialEnrollmentCode(input: {
  repository: Pick<EnrollmentCodeRotationRepository, 'createCode'>;
  actorUserId: string;
  pepper: string;
  id?: string;
  auditEventId?: string;
  entropy?: Uint8Array;
  now?: Date;
}): Promise<{ code: string; codePrefix: string; version: number }> {
  const now = validNow(input.now);
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const codeId = IdentifierSchema.parse(input.id ?? crypto.randomUUID());
  const auditEventId = IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID());
  const secret = await createEnrollmentCode({ entropy: input.entropy, pepper: input.pepper });
  const result = await input.repository.createCode({
    codeId,
    codeHash: secret.codeHash,
    codePrefix: secret.codePrefix,
    actorUserId,
    auditEventId,
    now,
  });
  if (result.outcome === 'active_exists') {
    throw appError('ENROLLMENT_CODE_ALREADY_ACTIVE', 'An enrollment code is already active.', 409);
  }
  return { code: secret.code, codePrefix: secret.codePrefix, version: result.version };
}

export async function rotateEnrollmentCode(input: {
  repository: Pick<EnrollmentCodeRotationRepository, 'rotateCode'>;
  actorUserId: string;
  pepper: string;
  reason?: string;
  id?: string;
  auditEventId?: string;
  entropy?: Uint8Array;
  now?: Date;
}): Promise<{
  code: string;
  codePrefix: string;
  version: number;
  revokedCodeId: string | null;
  revokedClaims: number;
}> {
  const now = validNow(input.now);
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const codeId = IdentifierSchema.parse(input.id ?? crypto.randomUUID());
  const auditEventId = IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID());
  const reason = RotationReasonSchema.parse(input.reason ?? 'owner_rotation');
  const secret = await createEnrollmentCode({ entropy: input.entropy, pepper: input.pepper });
  const rotated = await input.repository.rotateCode({
    codeId,
    codeHash: secret.codeHash,
    codePrefix: secret.codePrefix,
    actorUserId,
    auditEventId,
    reason,
    now,
  });
  return {
    code: secret.code,
    codePrefix: secret.codePrefix,
    version: rotated.version,
    revokedCodeId: rotated.revokedCodeId,
    revokedClaims: rotated.revokedClaims,
  };
}

export async function revokeEnrollmentCode(input: {
  repository: Pick<EnrollmentCodeRevocationRepository, 'revokeCode'>;
  actorUserId: string;
  auditEventId?: string;
  now?: Date;
}): Promise<{ changed: boolean; revokedClaims: number }> {
  const result = await input.repository.revokeCode({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    auditEventId: IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID()),
    reason: 'owner_disabled',
    now: validNow(input.now),
  });
  if (result.outcome === 'no_active_code') {
    return { changed: false, revokedClaims: 0 };
  }
  return { changed: true, revokedClaims: result.revokedClaims };
}
