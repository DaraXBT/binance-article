import { describe, expect, it } from 'vitest';

import * as databaseSchema from './schema';
import {
  account,
  auditEvent,
  binancePublicationDraft,
  captionPackage,
  deckProject,
  generationAccessGrant,
  invitation,
  jobRun,
  publisherCommand,
  publisherDevice,
  publicationDraft,
  publishApproval,
  rateLimitBucket,
  renderAsset,
  session,
  slide,
  storageObject,
  telegramUpdate,
  telegramAiMessage,
  telegramAiTask,
  telegramAssistantSettings,
  telegramMedia,
  usageLedger,
  user,
  userQuota,
  verification,
  workspace,
  workspaceMember,
  workspaceSession,
} from './schema';

const TABLE_NAME = Symbol.for('drizzle:Name');

function tableName(table: object): string {
  return (table as Record<symbol, string>)[TABLE_NAME];
}

describe('Drizzle schema', () => {
  it('mirrors every existing Prisma table without renaming deployed data', () => {
    expect([
      workspace,
      workspaceSession,
      deckProject,
      slide,
      captionPackage,
      renderAsset,
      jobRun,
      rateLimitBucket,
      generationAccessGrant,
    ].map(tableName)).toEqual([
      'Workspace',
      'WorkspaceSession',
      'DeckProject',
      'Slide',
      'CaptionPackage',
      'RenderAsset',
      'JobRun',
      'RateLimitBucket',
      'GenerationAccessGrant',
    ]);

    expect(workspace.accessKeyHash.name).toBe('accessKeyHash');
    expect(workspace.legacyClaimExpiresAt.name).toBe('legacyClaimExpiresAt');
    expect(deckProject.generationRevision.name).toBe('generationRevision');
    expect(slide.imageStatus.name).toBe('imageStatus');
    expect(jobRun.articleRevisionId.name).toBe('articleRevisionId');
  });

  it('provides the exact Better Auth core tables and fields', () => {
    expect([user, session, account, verification].map(tableName)).toEqual([
      'user',
      'session',
      'account',
      'verification',
    ]);

    expect(Object.keys(user)).toEqual(expect.arrayContaining([
      'id', 'name', 'email', 'emailVerified', 'image', 'status', 'role', 'createdAt', 'updatedAt',
    ]));
    expect(Object.keys(session)).toEqual(expect.arrayContaining([
      'id', 'userId', 'token', 'expiresAt', 'ipAddress', 'userAgent', 'createdAt', 'updatedAt',
    ]));
    expect(Object.keys(account)).toEqual(expect.arrayContaining([
      'id', 'userId', 'accountId', 'providerId', 'accessToken', 'refreshToken', 'idToken',
      'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'scope', 'password', 'createdAt', 'updatedAt',
    ]));
    expect(Object.keys(verification)).toEqual(expect.arrayContaining([
      'id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt',
    ]));
  });

  it('defines invite-only tenancy, quotas, private storage, publisher, approval, and audit tables', () => {
    expect([
      invitation,
      workspaceMember,
      userQuota,
      usageLedger,
      storageObject,
      binancePublicationDraft,
      publisherDevice,
      publisherCommand,
      publishApproval,
      auditEvent,
      telegramUpdate,
      telegramAssistantSettings,
      telegramAiTask,
      telegramAiMessage,
      telegramMedia,
    ].map(tableName)).toEqual([
      'Invitation',
      'WorkspaceMember',
      'UserQuota',
      'UsageLedger',
      'StorageObject',
      'BinancePublicationDraft',
      'PublisherDevice',
      'PublisherCommand',
      'PublishApproval',
      'AuditEvent',
      'TelegramUpdate',
      'TelegramAssistantSettings',
      'TelegramAiTask',
      'TelegramAiMessage',
      'TelegramMedia',
    ]);

    expect(workspaceMember.workspaceId.name).toBe('workspaceId');
    expect(workspaceMember.userId.name).toBe('userId');
    expect(storageObject.r2Key.name).toBe('r2Key');
    expect(publisherCommand.recipeHash.name).toBe('recipeHash');
    expect(publishApproval.callbackTokenHash.name).toBe('callbackTokenHash');
    expect(telegramUpdate.updateId.name).toBe('updateId');
    expect(telegramAiTask.inputText.name).toBe('inputText');
    expect(Object.keys(telegramAssistantSettings)).not.toContain('apiKey');
  });

  it('classifies every workspace with the fail-closed WorkspaceOrigin enum', () => {
    const originEnum = (databaseSchema as Record<string, unknown>).workspaceOrigin as {
      enumName?: string;
      enumValues?: string[];
    } | undefined;
    const originColumn = (workspace as unknown as Record<string, {
      name?: string;
      notNull?: boolean;
      hasDefault?: boolean;
      default?: unknown;
    } | undefined>).origin;

    expect(originEnum?.enumName).toBe('WorkspaceOrigin');
    expect(originEnum?.enumValues).toEqual(['legacy', 'account']);
    expect(originColumn?.name).toBe('origin');
    expect(originColumn?.notNull).toBe(true);
    expect(originColumn?.hasDefault).toBe(true);
    expect(originColumn?.default).toBe('legacy');
  });

  it('stores only hashes and object keys at cloud trust boundaries', () => {
    expect(Object.keys(invitation)).toContain('tokenHash');
    expect(Object.keys(invitation)).not.toContain('token');
    expect(Object.keys(publisherDevice)).toContain('tokenHash');
    expect(Object.keys(publisherDevice)).not.toContain('token');
    expect(Object.keys(publishApproval)).toContain('callbackTokenHash');
    expect(Object.keys(publishApproval)).not.toContain('callbackToken');

    const forbiddenCloudColumns = [
      ...Object.keys(binancePublicationDraft),
      ...Object.keys(publisherDevice),
      ...Object.keys(publisherCommand),
    ];
    expect(forbiddenCloudColumns).not.toEqual(expect.arrayContaining([
      'binanceCookie', 'binancePassword', 'chromeProfile', 'storageUrl', 'signedUrl',
    ]));
  });

  it('stores target-specific publication payloads without browser credentials', () => {
    expect(tableName(publicationDraft)).toBe('PublicationDraft');
    expect(publicationDraft.target.name).toBe('target');
    expect(publicationDraft.payload.name).toBe('payload');
    expect(publisherCommand.publicationDraftId.name).toBe('publicationDraftId');
    expect(Object.keys(publicationDraft)).not.toEqual(expect.arrayContaining([
      'cookie', 'password', 'chromeProfile', 'accessToken', 'signedUrl',
    ]));
  });

  it('defaults new approvals to the web review channel', () => {
    const approvalChannel = (publishApproval as unknown as Record<string, {
      default?: unknown;
      hasDefault?: boolean;
    }>).approvedVia;
    expect(approvalChannel?.hasDefault).toBe(true);
    expect(approvalChannel?.default).toBe('web');
  });
});
