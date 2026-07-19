import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
  assertAllowedOrigin: vi.fn(),
  readBoundedJson: vi.fn(async () => ({ accessKey: `dwk_${'a'.repeat(36)}` })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 4,
    resetAt: new Date('2026-07-19T00:15:00.000Z'),
  })),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  createLegacyClaimRepository: vi.fn(() => ({ repository: true })),
  claimLegacyWorkspace: vi.fn(async () => ({ id: 'workspace-2' })),
}));

const workspaceMock = vi.hoisted(() => ({
  getWorkspaceBootstrap: vi.fn(),
  createWorkspaceForCurrentSession: vi.fn(),
}));

const rateLimitMock = {
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  })),
};

vi.mock('@/server/modules/workspace/service', () => workspaceMock);
vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({
  assertAllowedOrigin: mocks.assertAllowedOrigin,
}));
vi.mock('@/server/http/rate-limit', () => rateLimitMock);
vi.mock('@/server/http/request-body', () => ({ readBoundedJson: mocks.readBoundedJson }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/legacy-claim-repository', () => ({
  createLegacyWorkspaceClaimRepository: mocks.createLegacyClaimRepository,
}));
vi.mock('@/server/modules/workspace/legacy-claim-service', () => ({
  claimLegacyWorkspace: mocks.claimLegacyWorkspace,
}));

describe('/api/workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ id: 'user_1', status: 'active' });
    mocks.readBoundedJson.mockResolvedValue({ accessKey: `dwk_${'a'.repeat(36)}` });
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-07-19T00:15:00.000Z'),
    });
    mocks.createLegacyClaimRepository.mockReturnValue({ repository: true });
    mocks.claimLegacyWorkspace.mockResolvedValue({ id: 'workspace-2' });
    rateLimitMock.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
  });

  it('returns workspace status without auto-creating for a fresh session', async () => {
    workspaceMock.getWorkspaceBootstrap.mockResolvedValue({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    });

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    });
  });

  it('returns a sanitized structured error when workspace bootstrap fails', async () => {
    workspaceMock.getWorkspaceBootstrap.mockRejectedValue(new Error('Prisma failed to open SQLite database'));

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to fetch workspace.',
      code: 'WORKSPACE_BOOTSTRAP_FAILED',
    });
  });

  it('creates a workspace explicitly for the current session', async () => {
    workspaceMock.createWorkspaceForCurrentSession.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        accessKeyPrefix: 'dwk_123456',
      },
      recoveryKey: 'dwk_1234567890',
    });

    const { POST } = await import('@/app/api/workspace/route');
    const response = await POST(
      new Request('http://localhost/api/workspace', { method: 'POST' }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_123456',
      recoveryKey: 'dwk_1234567890',
    });
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
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
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
