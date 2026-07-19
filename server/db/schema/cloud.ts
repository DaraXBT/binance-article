import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { deckProject, workspace } from './legacy';

const cloudTimestamp = (name: string) => timestamp(name, {
  mode: 'date',
  precision: 3,
  withTimezone: true,
});

export const invitationStatus = pgEnum('InvitationStatus', ['pending', 'accepted', 'revoked']);
export const workspaceMemberRole = pgEnum('WorkspaceMemberRole', ['owner', 'member']);
export const usageKind = pgEnum('UsageKind', ['article', 'image', 'workflow_step', 'storage_byte']);
export const usageStatus = pgEnum('UsageStatus', ['reserved', 'committed', 'released']);
export const storageObjectPurpose = pgEnum('StorageObjectPurpose', [
  'slide_image',
  'render',
  'publication',
  'backup',
]);
export const publicationDraftStatus = pgEnum('PublicationDraftStatus', [
  'draft',
  'prepared',
  'queued',
  'review_ready',
  'awaiting_approval',
  'authorized',
  'publishing',
  'published',
  'failed',
  'cancelled',
  'expired',
  'outcome_unknown',
]);
export const publisherDeviceStatus = pgEnum('PublisherDeviceStatus', ['pending', 'active', 'revoked']);
export const publisherCommandState = pgEnum('PublisherCommandState', [
  'queued',
  'claimed',
  'awaiting_review',
  'awaiting_approval',
  'approved',
  'publishing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'outcome_unknown',
]);
export const publishApprovalState = pgEnum('PublishApprovalState', [
  'pending',
  'confirmation_required',
  'approved',
  'cancelled',
  'expired',
]);
export const telegramUpdateStatus = pgEnum('TelegramUpdateStatus', [
  'processing',
  'processed',
  'rejected',
  'failed',
]);

export const invitation = pgTable('Invitation', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  tokenHash: text('tokenHash').notNull(),
  tokenPrefix: text('tokenPrefix').notNull(),
  status: invitationStatus('status').default('pending').notNull(),
  createdByUserId: text('createdByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  acceptedByUserId: text('acceptedByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  acceptedAt: cloudTimestamp('acceptedAt'),
  revokedAt: cloudTimestamp('revokedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('Invitation_tokenHash_key').on(table.tokenHash),
  index('Invitation_email_status_idx').on(table.email, table.status),
  index('Invitation_status_expiresAt_idx').on(table.status, table.expiresAt),
  check('Invitation_tokenHash_sha256_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);

export const workspaceMember = pgTable('WorkspaceMember', {
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  role: workspaceMemberRole('role').default('owner').notNull(),
  legacyClaimedAt: cloudTimestamp('legacyClaimedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: 'WorkspaceMember_pkey', columns: [table.workspaceId, table.userId] }),
  index('WorkspaceMember_userId_idx').on(table.userId),
]);

export const userQuota = pgTable('UserQuota', {
  userId: text('userId').primaryKey().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  articlesPerMonth: integer('articlesPerMonth').default(3).notNull(),
  imagesPerMonth: integer('imagesPerMonth').default(24).notNull(),
  maxSlidesPerArticle: integer('maxSlidesPerArticle').default(8).notNull(),
  publishingEnabled: boolean('publishingEnabled').default(true).notNull(),
  updatedByUserId: text('updatedByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  check('UserQuota_articles_nonnegative_check', sql`${table.articlesPerMonth} >= 0`),
  check('UserQuota_images_nonnegative_check', sql`${table.imagesPerMonth} >= 0`),
  check('UserQuota_slides_range_check', sql`${table.maxSlidesPerArticle} BETWEEN 1 AND 10`),
]);

export const usageLedger = pgTable('UsageLedger', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  kind: usageKind('kind').notNull(),
  status: usageStatus('status').default('reserved').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  period: text('period').notNull(),
  idempotencyKey: text('idempotencyKey').notNull(),
  metadata: jsonb('metadata'),
  committedAt: cloudTimestamp('committedAt'),
  releasedAt: cloudTimestamp('releasedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('UsageLedger_idempotencyKey_key').on(table.idempotencyKey),
  index('UsageLedger_userId_period_kind_status_idx').on(
    table.userId,
    table.period,
    table.kind,
    table.status,
  ),
  index('UsageLedger_workspaceId_createdAt_idx').on(table.workspaceId, table.createdAt),
  check('UsageLedger_quantity_positive_check', sql`${table.quantity} > 0`),
  check('UsageLedger_period_check', sql`${table.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
]);

export const storageObject = pgTable('StorageObject', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  articleId: text('articleId').references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  r2Key: text('r2Key').notNull(),
  purpose: storageObjectPurpose('purpose').notNull(),
  mimeType: text('mimeType').notNull(),
  sizeBytes: bigint('sizeBytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  deletedAt: cloudTimestamp('deletedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('StorageObject_r2Key_key').on(table.r2Key),
  index('StorageObject_workspaceId_articleId_idx').on(table.workspaceId, table.articleId),
  index('StorageObject_workspaceId_deletedAt_idx').on(table.workspaceId, table.deletedAt),
  check('StorageObject_size_nonnegative_check', sql`${table.sizeBytes} >= 0`),
  check('StorageObject_sha256_check', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
]);

export const binancePublicationDraft = pgTable('BinancePublicationDraft', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  articleId: text('articleId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  createdByUserId: text('createdByUserId').notNull().references(() => user.id, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),
  version: integer('version').default(1).notNull(),
  revision: integer('revision').default(1).notNull(),
  status: publicationDraftStatus('status').default('draft').notNull(),
  title: text('title').notNull(),
  markdown: text('markdown').notNull(),
  cover: jsonb('cover').notNull(),
  orderedAssetIds: jsonb('orderedAssetIds').notNull(),
  recipeHash: text('recipeHash'),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  publishedUrl: text('publishedUrl'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('BinancePublicationDraft_workspaceId_updatedAt_idx').on(table.workspaceId, table.updatedAt),
  index('BinancePublicationDraft_articleId_revision_idx').on(table.articleId, table.revision),
  uniqueIndex('BinancePublicationDraft_workspaceId_articleId_key').on(table.workspaceId, table.articleId),
  index('BinancePublicationDraft_status_expiresAt_idx').on(table.status, table.expiresAt),
  uniqueIndex('BinancePublicationDraft_id_revision_key').on(table.id, table.revision),
  check('BinancePublicationDraft_revision_positive_check', sql`${table.revision} > 0`),
]);

export const publisherDevice = pgTable('PublisherDevice', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  name: text('name').notNull(),
  tokenHash: text('tokenHash').notNull(),
  tokenPrefix: text('tokenPrefix').notNull(),
  status: publisherDeviceStatus('status').default('pending').notNull(),
  protocolVersion: integer('protocolVersion').default(1).notNull(),
  pairedAt: cloudTimestamp('pairedAt'),
  lastSeenAt: cloudTimestamp('lastSeenAt'),
  revokedAt: cloudTimestamp('revokedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('PublisherDevice_tokenHash_key').on(table.tokenHash),
  index('PublisherDevice_userId_status_idx').on(table.userId, table.status),
  index('PublisherDevice_workspaceId_status_idx').on(table.workspaceId, table.status),
  check('PublisherDevice_tokenHash_sha256_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);

export const publisherCommand = pgTable('PublisherCommand', {
  id: text('id').primaryKey(),
  draftId: text('draftId').notNull().references(() => binancePublicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  deviceId: text('deviceId').references(() => publisherDevice.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  state: publisherCommandState('state').default('queued').notNull(),
  revision: integer('revision').notNull(),
  recipeHash: text('recipeHash').notNull(),
  idempotencyKey: text('idempotencyKey').notNull(),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  claimedAt: cloudTimestamp('claimedAt'),
  resultUrl: text('resultUrl'),
  resultMetadata: jsonb('resultMetadata'),
  failureReason: text('failureReason'),
  completedAt: cloudTimestamp('completedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('PublisherCommand_idempotencyKey_key').on(table.idempotencyKey),
  index('PublisherCommand_deviceId_state_createdAt_idx').on(table.deviceId, table.state, table.createdAt),
  index('PublisherCommand_draftId_revision_idx').on(table.draftId, table.revision),
  index('PublisherCommand_state_expiresAt_idx').on(table.state, table.expiresAt),
  check('PublisherCommand_recipeHash_sha256_check', sql`${table.recipeHash} ~ '^[a-f0-9]{64}$'`),
]);

export const publishApproval = pgTable('PublishApproval', {
  id: text('id').primaryKey(),
  commandId: text('commandId').notNull().references(() => publisherCommand.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  draftId: text('draftId').notNull().references(() => binancePublicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  telegramUserId: text('telegramUserId').notNull(),
  callbackTokenHash: text('callbackTokenHash').notNull(),
  state: publishApprovalState('state').default('pending').notNull(),
  revision: integer('revision').notNull(),
  recipeHash: text('recipeHash').notNull(),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  consumedAt: cloudTimestamp('consumedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('PublishApproval_callbackTokenHash_key').on(table.callbackTokenHash),
  uniqueIndex('PublishApproval_commandId_open_key')
    .on(table.commandId)
    .where(sql`${table.state} IN ('pending', 'confirmation_required')`),
  index('PublishApproval_commandId_state_idx').on(table.commandId, table.state),
  index('PublishApproval_userId_state_idx').on(table.userId, table.state),
  index('PublishApproval_state_expiresAt_idx').on(table.state, table.expiresAt),
  check('PublishApproval_callbackTokenHash_sha256_check', sql`${table.callbackTokenHash} ~ '^[a-f0-9]{64}$'`),
  check('PublishApproval_recipeHash_sha256_check', sql`${table.recipeHash} ~ '^[a-f0-9]{64}$'`),
  check('PublishApproval_revision_positive_check', sql`${table.revision} > 0`),
  check('PublishApproval_expiry_after_creation_check', sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const auditEvent = pgTable('AuditEvent', {
  id: text('id').primaryKey(),
  actorUserId: text('actorUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').references(() => workspace.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  eventType: text('eventType').notNull(),
  subjectType: text('subjectType').notNull(),
  subjectId: text('subjectId'),
  metadata: jsonb('metadata'),
  ipHash: text('ipHash'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('AuditEvent_workspaceId_createdAt_idx').on(table.workspaceId, table.createdAt),
  index('AuditEvent_actorUserId_createdAt_idx').on(table.actorUserId, table.createdAt),
  index('AuditEvent_eventType_createdAt_idx').on(table.eventType, table.createdAt),
]);

export const telegramUpdate = pgTable('TelegramUpdate', {
  botId: text('botId').notNull(),
  updateId: bigint('updateId', { mode: 'number' }).notNull(),
  telegramUserId: text('telegramUserId'),
  payloadHash: text('payloadHash').notNull(),
  status: telegramUpdateStatus('status').default('processing').notNull(),
  errorCode: text('errorCode'),
  processedAt: cloudTimestamp('processedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: 'TelegramUpdate_pkey', columns: [table.botId, table.updateId] }),
  index('TelegramUpdate_createdAt_idx').on(table.createdAt),
  index('TelegramUpdate_telegramUserId_createdAt_idx').on(table.telegramUserId, table.createdAt),
  check('TelegramUpdate_payloadHash_sha256_check', sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
]);
