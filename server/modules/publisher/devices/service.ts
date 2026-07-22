import { z } from 'zod';

import { createInvitationSecret, hashInvitationToken } from '@/server/domain/invitations';
import { AppError } from '@/server/http/errors';

export const DEVICE_PAIRING_LIFETIME_MS = 10 * 60 * 1000;

const IdentifierSchema = z.string().trim().min(1).max(200);
const DeviceNameSchema = z.string().trim().min(1).max(80);
const SecretSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);

export interface PublisherDeviceRecord {
  id: string;
  userId?: string;
  workspaceId?: string;
  name?: string;
  status?: 'pending' | 'active' | 'revoked';
  protocolVersion: number;
}

export type PublisherDeviceStatus = 'pending' | 'active' | 'revoked';

export interface PublisherDeviceListItem {
  id: string;
  name: string;
  status: PublisherDeviceStatus;
  protocolVersion: number;
  lastSeenAt: Date | null;
}

export interface PublisherDeviceRepository {
  createPending(input: {
    id: string;
    userId: string;
    workspaceId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    now: Date;
  }): Promise<{ id: string } | null>;
  activatePending(input: {
    pairingHash: string;
    deviceTokenHash: string;
    deviceTokenPrefix: string;
    notBefore: Date;
    now: Date;
  }): Promise<PublisherDeviceRecord | null>;
  authenticate(input: {
    tokenHash: string;
    now: Date;
  }): Promise<PublisherDeviceRecord | null>;
  listForUserWorkspace(input: {
    actorUserId: string;
    workspaceId: string;
  }): Promise<PublisherDeviceListItem[]>;
  revokeForUserWorkspace(input: {
    actorUserId: string;
    workspaceId: string;
    deviceId: string;
    now: Date;
  }): Promise<boolean>;
}

function deviceError(code: string, message: string, status: number): AppError {
  return new AppError({ code, message, status });
}

export async function createPublisherDevicePairing(input: {
  repository: PublisherDeviceRepository;
  actorUserId: string;
  workspaceId: string;
  name: string;
  id?: string;
  entropy?: Uint8Array;
  now?: Date;
}) {
  const id = IdentifierSchema.parse(input.id ?? crypto.randomUUID());
  const userId = IdentifierSchema.parse(input.actorUserId);
  const workspaceId = IdentifierSchema.parse(input.workspaceId);
  const name = DeviceNameSchema.parse(input.name);
  const now = input.now ?? new Date();
  const secret = await createInvitationSecret(input.entropy);
  const created = await input.repository.createPending({
    id,
    userId,
    workspaceId,
    name,
    tokenHash: secret.tokenHash,
    tokenPrefix: secret.tokenPrefix,
    now,
  });
  if (!created) {
    throw deviceError('WORKSPACE_NOT_FOUND', 'Workspace not found.', 404);
  }
  return {
    deviceId: created.id,
    pairingCode: secret.token,
    tokenPrefix: secret.tokenPrefix,
    expiresAt: new Date(now.getTime() + DEVICE_PAIRING_LIFETIME_MS),
  };
}

export async function activatePublisherDevice(input: {
  repository: PublisherDeviceRepository;
  pairingCode: string;
  entropy?: Uint8Array;
  now?: Date;
}) {
  const pairingCode = SecretSchema.safeParse(input.pairingCode);
  if (!pairingCode.success) {
    throw deviceError('INVALID_PAIRING_CODE', 'The pairing code is invalid or expired.', 400);
  }
  const now = input.now ?? new Date();
  const deviceSecret = await createInvitationSecret(input.entropy);
  const device = await input.repository.activatePending({
    pairingHash: await hashInvitationToken(pairingCode.data),
    deviceTokenHash: deviceSecret.tokenHash,
    deviceTokenPrefix: deviceSecret.tokenPrefix,
    notBefore: new Date(now.getTime() - DEVICE_PAIRING_LIFETIME_MS),
    now,
  });
  if (!device) {
    throw deviceError('INVALID_PAIRING_CODE', 'The pairing code is invalid or expired.', 400);
  }
  return { device, deviceToken: deviceSecret.token };
}

export async function authenticatePublisherDevice(input: {
  repository: PublisherDeviceRepository;
  authorization: string | null;
  now?: Date;
}) {
  const match = input.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,256})$/i);
  if (!match) {
    throw deviceError('PUBLISHER_AUTH_REQUIRED', 'Publisher device authentication is required.', 401);
  }
  const now = input.now ?? new Date();
  const device = await input.repository.authenticate({
    tokenHash: await hashInvitationToken(match[1]),
    now,
  });
  if (!device || device.status !== 'active') {
    throw deviceError('PUBLISHER_AUTH_REQUIRED', 'Publisher device authentication is required.', 401);
  }
  return device;
}

export async function listPublisherDevices(input: {
  repository: PublisherDeviceRepository;
  actorUserId: string;
  workspaceId: string;
}): Promise<PublisherDeviceListItem[]> {
  return input.repository.listForUserWorkspace({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
  });
}

export async function revokePublisherDevice(input: {
  repository: PublisherDeviceRepository;
  actorUserId: string;
  workspaceId: string;
  deviceId: string;
  now?: Date;
}) {
  const revoked = await input.repository.revokeForUserWorkspace({
    actorUserId: IdentifierSchema.parse(input.actorUserId),
    workspaceId: IdentifierSchema.parse(input.workspaceId),
    deviceId: IdentifierSchema.parse(input.deviceId),
    now: input.now ?? new Date(),
  });
  if (!revoked) {
    throw deviceError('PUBLISHER_DEVICE_NOT_FOUND', 'Publisher device not found.', 404);
  }
  return { revoked: true as const };
}
