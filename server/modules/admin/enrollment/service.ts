import { z } from 'zod';

import { AppError } from '@/server/http/errors';

export type AdminEnrollmentCodeStatus = 'active' | 'revoked';

export interface EnrollmentOverview {
  code: {
    version: number;
    codePrefix: string;
    status: AdminEnrollmentCodeStatus;
    createdAt: Date | null;
  } | null;
  capacity: {
    activeUsers: number;
    legacyInvitations: number;
    reservedClaims: number;
    limit: number;
  };
}

export interface EnrollmentPerson {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'user';
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  enrollmentSource: string | null;
  createdAt: Date | null;
  lastActiveAt: Date | null;
  isCurrentUser: boolean;
}

export type PersonAction = 'suspend' | 'revoke' | 'restore';

export interface EnrollmentAdminRepository {
  getOverview(input: { now: Date; limit: number }): Promise<EnrollmentOverview>;
  listPeople(input: { actorUserId: string; limit: number }): Promise<EnrollmentPerson[]>;
  updatePersonStatus(input: {
    actorUserId: string;
    userId: string;
    action: PersonAction;
    now: Date;
    capacity: number;
    auditEventId: string;
  }): Promise<
    | { outcome: 'updated'; status: EnrollmentPerson['status'] }
    | {
      outcome:
        | 'not_found'
        | 'self'
        | 'owner'
        | 'last_owner'
        | 'invalid_transition'
        | 'capacity_full';
    }
  >;
}

const IdentifierSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const ActionSchema = z.enum(['suspend', 'revoke', 'restore']);

function appError(code: string, message: string, status: number): AppError {
  return new AppError({ code, message, status });
}

function validDate(value: Date | undefined): Date {
  const date = value ?? new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('The administration timestamp is invalid.');
  return date;
}

export async function getEnrollmentOverview(input: {
  repository: Pick<EnrollmentAdminRepository, 'getOverview'>;
  now?: Date;
  limit?: number;
}): Promise<EnrollmentOverview> {
  return input.repository.getOverview({
    now: validDate(input.now),
    limit: Math.min(Math.max(input.limit ?? 10, 1), 10_000),
  });
}

export async function listEnrollmentPeople(input: {
  repository: Pick<EnrollmentAdminRepository, 'listPeople'>;
  actorUserId: string;
  limit?: number;
}): Promise<EnrollmentPerson[]> {
  return input.repository.listPeople({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
  });
}

export async function updateEnrollmentPerson(input: {
  repository: Pick<EnrollmentAdminRepository, 'updatePersonStatus'>;
  actorUserId: string;
  userId: string;
  action: string;
  now?: Date;
  capacity?: number;
  auditEventId?: string;
}) {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const userId = IdentifierSchema.parse(input.userId);
  const action = ActionSchema.parse(input.action);
  const capacity = input.capacity ?? 10;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) {
    throw new Error('The enrollment capacity is invalid.');
  }
  const result = await input.repository.updatePersonStatus({
    actorUserId,
    userId,
    action,
    now: validDate(input.now),
    capacity,
    auditEventId: IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID()),
  });
  if (result.outcome === 'updated') return { updated: true as const, status: result.status };
  switch (result.outcome) {
    case 'not_found':
      throw appError('USER_NOT_FOUND', 'User not found.', 404);
    case 'self':
      throw appError('SELF_STATUS_CHANGE_BLOCKED', 'You cannot change your own account status.', 409);
    case 'owner':
      throw appError('OWNER_STATUS_CHANGE_BLOCKED', 'The administrator account cannot be changed here.', 409);
    case 'last_owner':
      throw appError('LAST_OWNER_PROTECTED', 'The last administrator account cannot be changed.', 409);
    case 'capacity_full':
      throw appError('BETA_USER_CAP_REACHED', 'The private beta user limit has been reached.', 409);
    case 'invalid_transition':
    default:
      throw appError('INVALID_USER_STATUS_TRANSITION', 'That account status change is not available.', 409);
  }
}
