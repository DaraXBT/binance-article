import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
  assertAllowedOrigin: vi.fn(),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  createLegacyClaimRepository: vi.fn(() => ({ repository: true })),
  claimLegacyWorkspace: vi.fn(async () => ({
    id: 'workspace-2', accessKeyPrefix: 'dwk_abcdef',
  })),
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
    mocks.createLegacyClaimRepository.mockReturnValue({ repository: true });
    mocks.claimLegacyWorkspace.mockResolvedValue({
      id: 'workspace-2', accessKeyPrefix: 'dwk_abcdef',
    });
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
    expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
      'legacy-workspace-claim:user_1', 5, 15 * 60 * 1_000,
    );
    expect(mocks.claimLegacyWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true },
      actorUserId: 'user_1',
      recoveryKey: `dwk_${'a'.repeat(36)}`,
    }));
    expect(body).toEqual({
      success: true,
      workspaceId: 'workspace-2',
      accessKeyPrefix: 'dwk_abcdef',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects rate-limited attempts before reading or hashing another recovery key', async () => {
    rateLimitMock.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
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
  });
});
