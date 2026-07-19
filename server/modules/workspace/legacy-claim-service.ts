import { z } from 'zod';

import { AppError } from '@/server/http/errors';

const ActorIdSchema = z.string().trim().min(1).max(200);
const RecoveryKeySchema = z.string().trim().regex(/^dwk_[a-f0-9]{36}$/);

export interface LegacyWorkspaceClaimRepository {
  claimByRecoveryHash(input: {
    actorUserId: string;
    accessKeyHash: string;
    auditEventId: string;
    now: Date;
  }): Promise<{ id: string } | null>;
}

function unavailable(): AppError {
  return new AppError({
    code: 'LEGACY_WORKSPACE_UNAVAILABLE',
    message: 'The recovery key is invalid or no longer available.',
    status: 404,
  });
}

async function hashRecoveryKey(recoveryKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recoveryKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function claimLegacyWorkspace(input: {
  repository: LegacyWorkspaceClaimRepository;
  actorUserId: string;
  recoveryKey: string;
  now?: Date;
}): Promise<{ id: string }> {
  const actorUserId = ActorIdSchema.parse(input.actorUserId);
  const parsedKey = RecoveryKeySchema.safeParse(input.recoveryKey);
  if (!parsedKey.success) throw unavailable();
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Claim timestamp is invalid.');

  const claimed = await input.repository.claimByRecoveryHash({
    actorUserId,
    accessKeyHash: await hashRecoveryKey(parsedKey.data),
    auditEventId: crypto.randomUUID(),
    now,
  });
  if (!claimed) throw unavailable();
  return { id: claimed.id };
}
