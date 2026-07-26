import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({
    id: 'user_1', sessionId: 'session_1', status: 'active',
  })),
  assertAllowedOrigin: vi.fn(),
  readBoundedJson: vi.fn(async () => ({ accessKey: `dwk_${'a'.repeat(36)}` })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 4,
    resetAt: new Date('2026-07-19T00:15:00.000Z'),
  })),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  resolveActorWorkspace: vi.fn<() => Promise<{
    id: string;
    accessKeyPrefix: string;
    origin: 'legacy' | 'account';
    workspaceRole: 'owner' | 'member';
    canReplaceWithLegacy: boolean;
  } | null>>(async () => null),
  isGenerateAccessEnabled: vi.fn(() => false),
  getCurrentGenerateAccessState: vi.fn(async () => ({
    hasAccess: true, invalidReason: null,
  })),
  createAccountWorkspaceRepository: vi.fn(() => ({ accountRepository: true })),
  createAccountWorkspace: vi.fn(async () => ({ id: 'workspace-1', created: true })),
  createLegacyClaimRepository: vi.fn(() => ({ repository: true })),
  claimLegacyWorkspace: vi.fn(async () => ({
    id: 'workspace-2', replacedWorkspace: false,
  })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({
  assertAllowedOrigin: mocks.assertAllowedOrigin,
}));
vi.mock('@/server/http/request-body', () => ({ readBoundedJson: mocks.readBoundedJson }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/lib/generate-access', () => ({
  isGenerateAccessEnabled: mocks.isGenerateAccessEnabled,
  getCurrentGenerateAccessState: mocks.getCurrentGenerateAccessState,
}));
vi.mock('@/server/modules/workspace/membership', () => ({
  resolveActorWorkspace: mocks.resolveActorWorkspace,
}));
vi.mock('@/server/modules/workspace/account-repository', () => ({
  createAccountWorkspaceRepository: mocks.createAccountWorkspaceRepository,
}));
vi.mock('@/server/modules/workspace/account-service', () => ({
  createAccountWorkspace: mocks.createAccountWorkspace,
}));
vi.mock('@/server/modules/workspace/legacy-claim-repository', () => ({
  createLegacyWorkspaceClaimRepository: mocks.createLegacyClaimRepository,
}));
vi.mock('@/server/modules/workspace/legacy-claim-service', () => ({
  claimLegacyWorkspace: mocks.claimLegacyWorkspace,
}));

describe('/api/workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({
      id: 'user_1', sessionId: 'session_1', status: 'active',
    });
    mocks.resolveActorWorkspace.mockResolvedValue(null);
    mocks.isGenerateAccessEnabled.mockReturnValue(false);
    mocks.getCurrentGenerateAccessState.mockResolvedValue({
      hasAccess: true, invalidReason: null,
    });
    mocks.createAccountWorkspaceRepository.mockReturnValue({ accountRepository: true });
    mocks.createAccountWorkspace.mockResolvedValue({ id: 'workspace-1', created: true });
    mocks.readBoundedJson.mockResolvedValue({ accessKey: `dwk_${'a'.repeat(36)}` });
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-07-19T00:15:00.000Z'),
    });
    mocks.createLegacyClaimRepository.mockReturnValue({ repository: true });
    mocks.claimLegacyWorkspace.mockResolvedValue({
      id: 'workspace-2', replacedWorkspace: false,
    });
  });

  it('returns account workspace status without auto-creating for a new user', async () => {
    const { GET } = await import('@/app/api/workspace/route');
    const request = new Request('https://articles.example.com/api/workspace');
    const response = await GET(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.resolveActorWorkspace).toHaveBeenCalledWith({ db: true }, 'user_1');
    expect(body).toEqual({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      workspaceOrigin: null,
      workspaceRole: null,
      canReplaceWithLegacy: false,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    });
  });

  it('binds generation access to the verified Better Auth session', async () => {
    mocks.resolveActorWorkspace.mockResolvedValue({
      id: 'workspace-1', accessKeyPrefix: 'acct_12345678',
      origin: 'account', workspaceRole: 'owner', canReplaceWithLegacy: true,
    });
    mocks.isGenerateAccessEnabled.mockReturnValue(true);

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET(new Request('https://articles.example.com/api/workspace') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getCurrentGenerateAccessState).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', sessionId: 'session_1',
    });
    expect(body).toMatchObject({
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'acct_12345678',
      recoveryKey: null,
      workspaceOrigin: 'account',
      workspaceRole: 'owner',
      canReplaceWithLegacy: true,
      generateAccessEnabled: true,
      hasGenerationAccess: true,
    });
  });

  it('marks a claimed legacy workspace as ineligible for placeholder replacement', async () => {
    mocks.resolveActorWorkspace.mockResolvedValue({
      id: 'workspace-legacy',
      accessKeyPrefix: 'dwk_12345678',
      origin: 'legacy',
      workspaceRole: 'owner',
      canReplaceWithLegacy: false,
    });

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET(new Request('https://articles.example.com/api/workspace') as never);

    await expect(response.json()).resolves.toMatchObject({
      hasWorkspace: true,
      workspaceId: 'workspace-legacy',
      workspaceOrigin: 'legacy',
      canReplaceWithLegacy: false,
    });
  });

  it('atomically creates an owner workspace for the active account without a recovery secret', async () => {
    const { POST } = await import('@/app/api/workspace/route');
    const request = new Request('https://articles.example.com/api/workspace', {
      method: 'POST', headers: { origin: 'https://articles.example.com' },
    });
    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.createAccountWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      repository: { accountRepository: true }, actorUserId: 'user_1',
    }));
    expect(body).toEqual({
      success: true,
      workspaceId: 'workspace-1',
      created: true,
    });
    expect(JSON.stringify(body)).not.toMatch(/recovery|accessKey/i);
  });

  it('claims a legacy workspace only for an authenticated active account', async () => {
    const { POST } = await import('@/app/api/workspace/recover/route');
    const request = new Request('https://articles.example.com/api/workspace/recover', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com' },
      body: JSON.stringify({ accessKey: `dwk_${'a'.repeat(36)}` }),
    });
    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith({
      database: { db: true },
      key: 'legacy-workspace-claim:user_1',
      limit: 5,
      windowMs: 15 * 60 * 1_000,
      now: expect.any(Date),
    });
    expect(mocks.claimLegacyWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true },
      actorUserId: 'user_1',
      recoveryKey: `dwk_${'a'.repeat(36)}`,
    }));
    expect(body).toEqual({
      success: true,
      workspaceId: 'workspace-2',
      replacedWorkspace: false,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports when legacy recovery replaced a pristine account workspace', async () => {
    mocks.claimLegacyWorkspace.mockResolvedValueOnce({
      id: 'workspace-legacy', replacedWorkspace: true,
    });
    const { POST } = await import('@/app/api/workspace/recover/route');
    const response = await POST(new Request('https://articles.example.com/api/workspace/recover', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com' },
      body: JSON.stringify({ accessKey: `dwk_${'d'.repeat(36)}` }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      workspaceId: 'workspace-legacy',
      replacedWorkspace: true,
    });
  });

  it('rejects rate-limited attempts before reading or hashing another recovery key', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('@/app/api/workspace/recover/route');
    const response = await POST(
      new Request('https://articles.example.com/api/workspace/recover', {
        method: 'POST',
        headers: { origin: 'https://articles.example.com' },
        body: JSON.stringify({ accessKey: `dwk_${'b'.repeat(36)}` }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mocks.claimLegacyWorkspace).not.toHaveBeenCalled();
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('authenticates before reading a recovery key or opening the database', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    const { POST } = await import('@/app/api/workspace/recover/route');
    const response = await POST(new Request('https://articles.example.com/api/workspace/recover', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com' },
      body: JSON.stringify({ accessKey: `dwk_${'c'.repeat(36)}` }),
    }) as never);

    expect(response.status).toBe(401);
    expect(mocks.readBoundedJson).not.toHaveBeenCalled();
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
  });
});
