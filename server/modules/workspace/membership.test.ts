import { describe, expect, it, vi } from 'vitest';

import {
  requireActorWorkspace,
  requireActorWorkspaceOwner,
  requireArticleWorkspace,
  resolveActorWorkspace,
} from './membership';

function databaseReturning(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin, where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select } as never, select, from, innerJoin, where, limit };
}

describe('authenticated workspace membership', () => {
  it('resolves the account workspace without consulting a legacy browser session', async () => {
    const query = databaseReturning([{
      id: 'workspace_1',
      accessKeyPrefix: 'dwk_aaaa',
      origin: 'legacy',
      workspaceRole: 'owner',
      canReplaceWithLegacy: false,
    }]);
    await expect(resolveActorWorkspace(query.database, 'user_1')).resolves.toEqual({
      id: 'workspace_1', accessKeyPrefix: 'dwk_aaaa', origin: 'legacy',
      workspaceRole: 'owner',
      canReplaceWithLegacy: false,
    });
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('returns null for an enrolled account that has not created or claimed a workspace', async () => {
    await expect(resolveActorWorkspace(databaseReturning([]).database, 'user_1'))
      .resolves.toBeNull();
  });

  it('fails closed if pre-migration data gives one account multiple workspaces', async () => {
    await expect(resolveActorWorkspace(databaseReturning([
      { id: 'workspace_1', accessKeyPrefix: 'dwk_aaaa' },
      { id: 'workspace_2', accessKeyPrefix: 'dwk_bbbb' },
    ]).database, 'user_1')).rejects.toMatchObject({
      code: 'WORKSPACE_MEMBERSHIP_CONFLICT', status: 409,
    });
  });

  it('requires an account workspace with a sanitized not-found error', async () => {
    await expect(requireActorWorkspace(databaseReturning([]).database, 'user_1'))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND', status: 404 });
  });

  it('authorizes only the workspace membership owner regardless of the global user role', async () => {
    const owner = databaseReturning([{
      id: 'workspace_1', accessKeyPrefix: 'acct_aaaaaaaa', origin: 'account',
      workspaceRole: 'owner', canReplaceWithLegacy: false,
    }]);
    await expect(requireActorWorkspaceOwner(owner.database, 'global_user'))
      .resolves.toMatchObject({ id: 'workspace_1', workspaceRole: 'owner' });

    const member = databaseReturning([{
      id: 'workspace_1', accessKeyPrefix: 'acct_aaaaaaaa', origin: 'account',
      workspaceRole: 'member', canReplaceWithLegacy: false,
    }]);
    await expect(requireActorWorkspaceOwner(member.database, 'global_admin'))
      .rejects.toMatchObject({ code: 'WORKSPACE_OWNER_REQUIRED', status: 403 });
  });

  it('requires exact article membership and keeps cross-tenant IDs opaque', async () => {
    await expect(requireArticleWorkspace(
      databaseReturning([{ workspaceId: 'workspace_1' }]).database,
      'user_1',
      'article_1',
    )).resolves.toBe('workspace_1');
    await expect(requireArticleWorkspace(
      databaseReturning([]).database,
      'user_1',
      'article_other',
    )).rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND', status: 404 });
  });
});
