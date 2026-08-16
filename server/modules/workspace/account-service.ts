import { z } from 'zod';

import { AppError } from '@/server/http/errors';

const IdentifierSchema = z.string().trim().min(1).max(200);

export interface AccountWorkspaceRepository {
  createOrFind(input: {
    actorUserId: string;
    workspaceId: string;
    auditEventId: string;
    accessKeyHash: string;
    accessKeyPrefix: string;
    now: Date;
  }): Promise<{ id: string; created: boolean } | null>;
}

function randomEntropy(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createAccountWorkspace(input: {
  repository: AccountWorkspaceRepository;
  actorUserId: string;
  workspaceId?: string;
  auditEventId?: string;
  entropy?: Uint8Array;
  now?: Date;
}): Promise<{ id: string; created: boolean }> {
  const actorUserId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId ?? crypto.randomUUID());
  const auditEventId = IdentifierSchema.parse(input.auditEventId ?? crypto.randomUUID());
  const entropy = input.entropy ?? randomEntropy();
  if (entropy.byteLength !== 32) throw new Error('Workspace entropy must contain 32 bytes.');
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Workspace creation timestamp is invalid.');
  const accessKeyHash = await sha256Hex(entropy);

  const workspace = await input.repository.createOrFind({
    actorUserId,
    workspaceId,
    auditEventId,
    accessKeyHash,
    accessKeyPrefix: `acct_${accessKeyHash.slice(0, 8)}`,
    now,
  });
  if (!workspace) {
    throw new AppError({
      code: 'WORKSPACE_CREATE_CONFLICT',
      message: 'The account library could not be prepared.',
      status: 409,
    });
  }
  return workspace;
}
