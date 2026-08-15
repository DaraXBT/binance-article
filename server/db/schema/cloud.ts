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

import { DEFAULT_ILLUSTRATION_STYLE } from '../../../lib/config';
import { user } from './auth';
import { deckProject, jobRun, slideImageStatus, workspace } from './legacy';

const cloudTimestamp = (name: string) => timestamp(name, {
  mode: 'date',
  precision: 3,
  withTimezone: true,
});

export const invitationStatus = pgEnum('InvitationStatus', ['pending', 'accepted', 'revoked']);
export const aiCredentialProvider = pgEnum('AiCredentialProvider', ['gemini']);
export const workspaceMemberRole = pgEnum('WorkspaceMemberRole', ['owner', 'member']);
export const usageKind = pgEnum('UsageKind', ['article', 'image', 'workflow_step', 'storage_byte']);
export const usageStatus = pgEnum('UsageStatus', ['reserved', 'committed', 'released']);
export const storageObjectPurpose = pgEnum('StorageObjectPurpose', [
  'slide_image',
  'cover_image',
  'render',
  'publication',
  'backup',
  'telegram_image',
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
export const publicationTarget = pgEnum('PublicationTarget', ['binance-square', 'x']);
export const publicationKind = pgEnum('PublicationKind', ['post', 'article']);
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
export const publishApprovalVia = pgEnum('PublishApprovalVia', ['web', 'telegram']);
export const telegramUpdateStatus = pgEnum('TelegramUpdateStatus', [
  'processing',
  'processed',
  'rejected',
  'failed',
]);
export const telegramTextProvider = pgEnum('TelegramTextProvider', ['gemini', 'deepseek']);
export const telegramTaskKind = pgEnum('TelegramTaskKind', ['chat', 'article', 'image', 'prepare']);
export const telegramTaskStatus = pgEnum('TelegramTaskStatus', [
  'queued',
  'running',
  'generated',
  'delivering',
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
]);
export const telegramMessageRole = pgEnum('TelegramMessageRole', ['user', 'assistant']);

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
  uniqueIndex('WorkspaceMember_workspaceId_owner_key')
    .on(table.workspaceId)
    .where(sql`${table.role} = 'owner'`),
  uniqueIndex('WorkspaceMember_userId_single_workspace_key').on(table.userId),
]);

export const workspaceAiCredential = pgTable('WorkspaceAiCredential', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  provider: aiCredentialProvider('provider').notNull(),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  encryptionKeyId: text('encryptionKeyId').notNull(),
  enabled: boolean('enabled').default(false).notNull(),
  createdByUserId: text('createdByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  updatedByUserId: text('updatedByUserId').references(() => user.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  validatedAt: cloudTimestamp('validatedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('WorkspaceAiCredential_workspaceId_provider_key')
    .on(table.workspaceId, table.provider),
  index('WorkspaceAiCredential_workspaceId_updatedAt_idx')
    .on(table.workspaceId, table.updatedAt),
  check(
    'WorkspaceAiCredential_ciphertext_base64url_check',
    sql`${table.ciphertext} ~ '^[A-Za-z0-9_-]{24,2048}$'`,
  ),
  check(
    'WorkspaceAiCredential_ciphertext_base64url_length_check',
    sql`char_length(${table.ciphertext}) % 4 <> 1`,
  ),
  check(
    'WorkspaceAiCredential_nonce_base64url_check',
    sql`${table.nonce} ~ '^[A-Za-z0-9_-]{16}$'`,
  ),
  check(
    'WorkspaceAiCredential_encryptionKeyId_check',
    sql`${table.encryptionKeyId} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`,
  ),
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

export const telegramAssistantSettings = pgTable('TelegramAssistantSettings', {
  userId: text('userId').primaryKey().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  enabled: boolean('enabled').default(true).notNull(),
  textProvider: telegramTextProvider('textProvider').default('gemini').notNull(),
  defaultSlideCount: integer('defaultSlideCount').default(4).notNull(),
  illustrationStyle: text('illustrationStyle').default(DEFAULT_ILLUSTRATION_STYLE).notNull(),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  check('TelegramAssistantSettings_defaultSlideCount_check', sql`${table.defaultSlideCount} BETWEEN 1 AND 8`),
  check(
    'TelegramAssistantSettings_illustrationStyle_check',
    sql`${table.illustrationStyle} IN (
      'pixel-art',
      'fantasy-animation',
      'lab-notes',
      'binance',
      'binance-master',
      'binance-briefing',
      'binance-mondo-panoramic',
      'binance-sketch-notes',
      'binance-vector-illustration'
    )`,
  ),
]);

export const telegramAiTask = pgTable('TelegramAiTask', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  botId: text('botId').notNull(),
  updateId: bigint('updateId', { mode: 'number' }).notNull(),
  telegramUserId: text('telegramUserId').notNull(),
  chatId: text('chatId').notNull(),
  kind: telegramTaskKind('kind').notNull(),
  status: telegramTaskStatus('status').default('queued').notNull(),
  provider: telegramTextProvider('provider'),
  model: text('model'),
  inputText: text('inputText'),
  articleId: text('articleId').references(() => deckProject.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  jobId: text('jobId').references(() => jobRun.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  placeholderMessageId: bigint('placeholderMessageId', { mode: 'number' }),
  resultText: text('resultText'),
  resultMetadata: jsonb('resultMetadata'),
  temporaryAssetKey: text('temporaryAssetKey'),
  errorCode: text('errorCode'),
  errorMessage: text('errorMessage'),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  completedAt: cloudTimestamp('completedAt'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('TelegramAiTask_botId_updateId_key').on(table.botId, table.updateId),
  index('TelegramAiTask_userId_status_createdAt_idx').on(table.userId, table.status, table.createdAt),
  index('TelegramAiTask_workspaceId_createdAt_idx').on(table.workspaceId, table.createdAt),
  index('TelegramAiTask_expiresAt_idx').on(table.expiresAt),
]);

export const telegramAiMessage = pgTable('TelegramAiMessage', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  taskId: text('taskId').references(() => telegramAiTask.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  telegramUserId: text('telegramUserId').notNull(),
  role: telegramMessageRole('role').notNull(),
  content: text('content').notNull(),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('TelegramAiMessage_userId_createdAt_idx').on(table.userId, table.createdAt),
  index('TelegramAiMessage_expiresAt_idx').on(table.expiresAt),
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

export const articleCover = pgTable('ArticleCover', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  articleId: text('articleId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  generationRevision: integer('generationRevision').default(0).notNull(),
  style: text('style').default(DEFAULT_ILLUSTRATION_STYLE).notNull(),
  styleMode: text('styleMode'),
  prompt: text('prompt'),
  status: slideImageStatus('status').default('pending').notNull(),
  sourceAssetId: text('sourceAssetId').references(() => storageObject.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  error: text('error'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ArticleCover_articleId_key').on(table.articleId),
  index('ArticleCover_workspaceId_updatedAt_idx').on(table.workspaceId, table.updatedAt),
  index('ArticleCover_status_updatedAt_idx').on(table.status, table.updatedAt),
  check('ArticleCover_generationRevision_nonnegative_check', sql`${table.generationRevision} >= 0`),
  check(
    'ArticleCover_styleMode_check',
    sql`${table.styleMode} IS NULL OR ${table.styleMode} IN ('scene', 'mechanism', 'briefing', 'primer')`,
  ),
]);

export const telegramMedia = pgTable('TelegramMedia', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  taskId: text('taskId').references(() => telegramAiTask.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  storageObjectId: text('storageObjectId').notNull().references(() => storageObject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  prompt: text('prompt'),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('TelegramMedia_storageObjectId_key').on(table.storageObjectId),
  index('TelegramMedia_userId_createdAt_idx').on(table.userId, table.createdAt),
  index('TelegramMedia_expiresAt_idx').on(table.expiresAt),
]);

export const publicationDraft = pgTable('PublicationDraft', {
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
  target: publicationTarget('target').notNull(),
  kind: publicationKind('kind').notNull(),
  version: integer('version').default(3).notNull(),
  revision: integer('revision').default(1).notNull(),
  status: publicationDraftStatus('status').default('draft').notNull(),
  payload: jsonb('payload').notNull(),
  recipeHash: text('recipeHash'),
  expiresAt: cloudTimestamp('expiresAt').notNull(),
  publishedUrl: text('publishedUrl'),
  createdAt: cloudTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: cloudTimestamp('updatedAt').defaultNow().notNull(),
}, (table) => [
  index('PublicationDraft_workspaceId_updatedAt_idx').on(table.workspaceId, table.updatedAt),
  index('PublicationDraft_articleId_target_revision_idx').on(table.articleId, table.target, table.revision),
  uniqueIndex('PublicationDraft_workspaceId_articleId_target_kind_key')
    .on(table.workspaceId, table.articleId, table.target, table.kind),
  index('PublicationDraft_status_expiresAt_idx').on(table.status, table.expiresAt),
  uniqueIndex('PublicationDraft_id_revision_key').on(table.id, table.revision),
  check('PublicationDraft_version_check', sql`${table.version} IN (2, 3)`),
  check('PublicationDraft_revision_positive_check', sql`${table.revision} > 0`),
  check(
    'PublicationDraft_recipeHash_sha256_check',
    sql`${table.recipeHash} IS NULL OR ${table.recipeHash} ~ '^[a-f0-9]{64}$'`,
  ),
]);

/** @deprecated Compatibility table retained during the PublicationDraft expand-contract release. */
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
  draftId: text('draftId').references(() => binancePublicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  publicationDraftId: text('publicationDraftId').references(() => publicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  target: publicationTarget('target').default('binance-square').notNull(),
  kind: publicationKind('kind').notNull(),
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
  index('PublisherCommand_publicationDraftId_revision_idx').on(table.publicationDraftId, table.revision),
  index('PublisherCommand_target_state_createdAt_idx').on(table.target, table.state, table.createdAt),
  index('PublisherCommand_state_expiresAt_idx').on(table.state, table.expiresAt),
  check(
    'PublisherCommand_draft_reference_check',
    sql`${table.draftId} IS NOT NULL OR ${table.publicationDraftId} IS NOT NULL`,
  ),
  check('PublisherCommand_recipeHash_sha256_check', sql`${table.recipeHash} ~ '^[a-f0-9]{64}$'`),
]);

export const publishApproval = pgTable('PublishApproval', {
  id: text('id').primaryKey(),
  commandId: text('commandId').notNull().references(() => publisherCommand.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  draftId: text('draftId').references(() => binancePublicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  publicationDraftId: text('publicationDraftId').references(() => publicationDraft.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  userId: text('userId').notNull().references(() => user.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  approvedVia: publishApprovalVia('approvedVia').default('web').notNull(),
  telegramUserId: text('telegramUserId'),
  callbackTokenHash: text('callbackTokenHash'),
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
  index('PublishApproval_publicationDraftId_state_idx').on(table.publicationDraftId, table.state),
  index('PublishApproval_userId_state_idx').on(table.userId, table.state),
  index('PublishApproval_state_expiresAt_idx').on(table.state, table.expiresAt),
  check(
    'PublishApproval_callbackTokenHash_sha256_check',
    sql`${table.callbackTokenHash} IS NULL OR ${table.callbackTokenHash} ~ '^[a-f0-9]{64}$'`,
  ),
  check('PublishApproval_recipeHash_sha256_check', sql`${table.recipeHash} ~ '^[a-f0-9]{64}$'`),
  check('PublishApproval_revision_positive_check', sql`${table.revision} > 0`),
  check('PublishApproval_expiry_after_creation_check', sql`${table.expiresAt} > ${table.createdAt}`),
  check(
    'PublishApproval_draft_reference_check',
    sql`${table.draftId} IS NOT NULL OR ${table.publicationDraftId} IS NOT NULL`,
  ),
  check(
    'PublishApproval_channel_metadata_check',
    sql`(${table.approvedVia} = 'web' AND ${table.telegramUserId} IS NULL AND ${table.callbackTokenHash} IS NULL)
      OR (${table.approvedVia} = 'telegram' AND ${table.telegramUserId} IS NOT NULL AND ${table.callbackTokenHash} IS NOT NULL)`,
  ),
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
