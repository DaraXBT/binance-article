import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = {
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 4,
    resetAt: new Date(Date.now() + 60_000),
  })),
};

const authMock = {
  requireActiveUser: vi.fn(async () => ({ id: 'user-1', sessionId: 'session-1' })),
};
const workspaceMock = {
  requireActorWorkspace: vi.fn(async () => ({ id: 'workspace-1' })),
};
const runtimeMock = { getRuntimeDatabase: vi.fn(() => ({ db: true })) };
const bodyMock = { readBoundedJson: vi.fn(async () => ({ code: 'gac_valid_code' })) };
const originMock = { assertAllowedOrigin: vi.fn() };

const generateAccessMock = {
  isGenerateAccessEnabled: vi.fn<() => boolean>(() => true),
  consumeGenerateAccessGrant: vi.fn<
    () => Promise<
      | { ok: true; grantId: string }
      | { ok: false; reason: 'invalid_code' | 'rotated' | 'already_used' | 'revoked' }
    >
  >(async () => ({
    ok: true,
    grantId: 'grant-1',
  })),
  grantGenerateAccess: vi.fn((response: Response & { cookies: { set: (name: string, value: string) => void } }, grantId: string) => {
    response.cookies.set('deckforge_generate_access', grantId);
  }),
};

vi.mock('@/server/http/atomic-rate-limit', () => rateLimitMock);
vi.mock('@/server/auth/authorization', () => authMock);
vi.mock('@/server/modules/workspace/membership', () => workspaceMock);
vi.mock('@/server/db/runtime', () => runtimeMock);
vi.mock('@/server/http/request-body', () => bodyMock);
vi.mock('@/server/auth/origin', () => originMock);
vi.mock('@/lib/generate-access', () => generateAccessMock);

describe('/api/generate-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(true);
    generateAccessMock.consumeGenerateAccessGrant.mockResolvedValue({
      ok: true,
      grantId: 'grant-1',
    });
    authMock.requireActiveUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    workspaceMock.requireActorWorkspace.mockResolvedValue({ id: 'workspace-1' });
    bodyMock.readBoundedJson.mockResolvedValue({ code: 'gac_valid_code' });
    rateLimitMock.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true, remaining: 4, resetAt: new Date(Date.now() + 60_000),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('accepts a valid invite code and sets the generation access cookie', async () => {
    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(
      new Request('https://articles.example.com/api/generate-access', {
        method: 'POST',
        headers: { origin: 'https://articles.example.com' },
        body: '{}',
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(generateAccessMock.consumeGenerateAccessGrant).toHaveBeenCalledWith({
      code: 'gac_valid_code',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    });
    expect(response.headers.get('set-cookie')).toContain('deckforge_generate_access');
    expect(rateLimitMock.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { db: true }, key: 'generate-access:user-1', limit: 5,
    }));
  });

  it('rejects an invalid invite code', async () => {
    generateAccessMock.consumeGenerateAccessGrant.mockResolvedValue({
      ok: false,
      reason: 'invalid_code',
    });

    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(
      new Request('https://articles.example.com/api/generate-access', {
        method: 'POST',
        headers: { origin: 'https://articles.example.com' },
        body: '{}',
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Invalid generation code',
      code: 'INVALID_GENERATE_CODE',
      reason: 'invalid_code',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns a rotation-specific error when the code belongs to an old env version', async () => {
    generateAccessMock.consumeGenerateAccessGrant.mockResolvedValue({
      ok: false,
      reason: 'rotated',
    });

    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(
      new Request('https://articles.example.com/api/generate-access', {
        method: 'POST',
        headers: { origin: 'https://articles.example.com' },
        body: '{}',
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Generation access code has changed. Please request the latest code from the admin.',
      code: 'INVALID_GENERATE_CODE',
      reason: 'rotated',
    });
  });

  it('authenticates before parsing or rate-limiting a generation code', async () => {
    const { AppError } = await import('@/server/http/errors');
    authMock.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(new Request('https://articles.example.com/api/generate-access', {
      method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}',
    }) as never);
    expect(response.status).toBe(401);
    expect(bodyMock.readBoundedJson).not.toHaveBeenCalled();
    expect(rateLimitMock.consumeAtomicRateLimit).not.toHaveBeenCalled();
  });
});
