import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const legacyTimestamp = (name: string) => timestamp(name, {
  mode: 'date',
  precision: 3,
  withTimezone: false,
});

export const deckStatus = pgEnum('DeckStatus', [
  'draft',
  'queued',
  'generating',
  'ready',
  'rendering',
  'failed',
]);
export const slideImageStatus = pgEnum('SlideImageStatus', ['pending', 'generated', 'failed']);
export const jobKind = pgEnum('JobKind', ['generate', 'generate_images', 'render']);
export const jobStatus = pgEnum('JobStatus', ['queued', 'running', 'completed', 'failed', 'cancelled']);
export const assetFormat = pgEnum('AssetFormat', ['pdf', 'pptx', 'png']);
export const generationAccessGrantStatus = pgEnum('GenerationAccessGrantStatus', [
  'active',
  'consumed',
  'revoked',
]);

export const workspace = pgTable('Workspace', {
  id: text('id').primaryKey(),
  accessKeyHash: text('accessKeyHash').notNull(),
  accessKeyPrefix: text('accessKeyPrefix').notNull(),
  legacyClaimExpiresAt: timestamp('legacyClaimExpiresAt', {
    mode: 'date',
    precision: 3,
    withTimezone: true,
  }),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('Workspace_accessKeyHash_key').on(table.accessKeyHash),
  index('Workspace_accessKeyPrefix_idx').on(table.accessKeyPrefix),
]);

export const workspaceSession = pgTable('WorkspaceSession', {
  id: text('id').primaryKey(),
  sessionId: text('sessionId').notNull(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('WorkspaceSession_sessionId_key').on(table.sessionId),
  index('WorkspaceSession_workspaceId_idx').on(table.workspaceId),
]);

export const deckProject = pgTable('DeckProject', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  title: text('title').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  theme: text('theme').default('default').notNull(),
  customTheme: jsonb('customTheme'),
  illustrationStyle: text('illustrationStyle').default('pixel-art').notNull(),
  status: deckStatus('status').default('draft').notNull(),
  generationRevision: integer('generationRevision').default(0).notNull(),
  lastCompletedRevision: integer('lastCompletedRevision').default(0).notNull(),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  index('DeckProject_workspaceId_updatedAt_idx').on(table.workspaceId, table.updatedAt),
  index('DeckProject_status_idx').on(table.status),
]);

export const slide = pgTable('Slide', {
  id: text('id').primaryKey(),
  deckId: text('deckId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  bullets: jsonb('bullets').notNull(),
  notes: text('notes'),
  imageUrl: text('imageUrl'),
  imageStatus: slideImageStatus('imageStatus').default('pending').notNull(),
  imageError: text('imageError'),
  imagePrompt: text('imagePrompt'),
  order: integer('order').notNull(),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  index('Slide_deckId_idx').on(table.deckId),
  uniqueIndex('Slide_deckId_order_key').on(table.deckId, table.order),
]);

export const captionPackage = pgTable('CaptionPackage', {
  id: text('id').primaryKey(),
  deckId: text('deckId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  blogTitle: text('blogTitle'),
  blogMeta: text('blogMeta'),
  blogIntro: text('blogIntro'),
  blogSections: jsonb('blogSections'),
  blogTags: jsonb('blogTags'),
  xSingle1: text('xSingle1'),
  xSingle2: text('xSingle2'),
  xSingle3: text('xSingle3'),
  xThread: text('xThread'),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  uniqueIndex('CaptionPackage_deckId_key').on(table.deckId),
  index('CaptionPackage_deckId_idx').on(table.deckId),
]);

export const jobRun = pgTable('JobRun', {
  id: text('id').primaryKey(),
  deckId: text('deckId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  workspaceId: text('workspaceId').notNull().references(() => workspace.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  kind: jobKind('kind').notNull(),
  status: jobStatus('status').default('queued').notNull(),
  progress: integer('progress').default(0).notNull(),
  logs: jsonb('logs').notNull(),
  errorCode: text('errorCode'),
  errorMessage: text('errorMessage'),
  articleRevisionId: text('articleRevisionId').notNull(),
  runId: text('runId'),
  payload: jsonb('payload'),
  result: jsonb('result'),
  startedAt: legacyTimestamp('startedAt'),
  completedAt: legacyTimestamp('completedAt'),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [
  index('JobRun_deckId_createdAt_idx').on(table.deckId, table.createdAt),
  index('JobRun_workspaceId_createdAt_idx').on(table.workspaceId, table.createdAt),
  index('JobRun_status_kind_idx').on(table.status, table.kind),
  index('JobRun_articleRevisionId_idx').on(table.articleRevisionId),
]);

export const renderAsset = pgTable('RenderAsset', {
  id: text('id').primaryKey(),
  deckId: text('deckId').notNull().references(() => deckProject.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  filename: text('filename').notNull(),
  format: assetFormat('format').notNull(),
  mimeType: text('mimeType').notNull(),
  filePath: text('filePath').notNull(),
  fileSize: integer('fileSize'),
  storageProvider: text('storageProvider').default('blob').notNull(),
  jobId: text('jobId').references(() => jobRun.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
}, (table) => [
  index('RenderAsset_deckId_idx').on(table.deckId),
  index('RenderAsset_jobId_idx').on(table.jobId),
  uniqueIndex('RenderAsset_deckId_filename_key').on(table.deckId, table.filename),
]);

export const rateLimitBucket = pgTable('RateLimitBucket', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: legacyTimestamp('resetAt').notNull(),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').notNull(),
}, (table) => [index('RateLimitBucket_resetAt_idx').on(table.resetAt)]);

export const generationAccessGrant = pgTable('GenerationAccessGrant', {
  id: text('id').primaryKey(),
  codeHash: text('codeHash').notNull(),
  codePrefix: text('codePrefix').notNull(),
  status: generationAccessGrantStatus('status').default('active').notNull(),
  boundWorkspaceId: text('boundWorkspaceId').references(() => workspace.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  boundSessionId: text('boundSessionId'),
  consumedAt: legacyTimestamp('consumedAt'),
  envCodeHash: text('envCodeHash').notNull(),
  createdAt: legacyTimestamp('createdAt').defaultNow().notNull(),
  updatedAt: legacyTimestamp('updatedAt').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex('GenerationAccessGrant_codeHash_key').on(table.codeHash),
  index('GenerationAccessGrant_codePrefix_idx').on(table.codePrefix),
  index('GenerationAccessGrant_boundWorkspaceId_idx').on(table.boundWorkspaceId),
  index('GenerationAccessGrant_boundSessionId_idx').on(table.boundSessionId),
  index('GenerationAccessGrant_status_envCodeHash_idx').on(table.status, table.envCodeHash),
]);
