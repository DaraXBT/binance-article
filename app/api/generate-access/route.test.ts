import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = {
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 60_000,
  }),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    sessionId: 'session-1',
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

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

vi.mock('@/server/http/rate-limit', () => rateLimitMock);
vi.mock('@/server/modules/workspace/service', () => workspaceMock);
vi.mock('@/lib/generate-access', () => generateAccessMock);

describe('/api/generate-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(true);
    generateAccessMock.consumeGenerateAccessGrant.mockResolvedValue({
      ok: true,
      grantId: 'grant-1',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('accepts a valid invite code and sets the generation access cookie', async () => {
    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(
      new Request('http://localhost/api/generate-access', {
        method: 'POST',
        body: JSON.stringify({ code: 'gac_valid_code' }),
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
  });

  it('rejects an invalid invite code', async () => {
    generateAccessMock.consumeGenerateAccessGrant.mockResolvedValue({
      ok: false,
      reason: 'invalid_code',
    });

    const { POST } = await import('@/app/api/generate-access/route');
    const response = await POST(
      new Request('http://localhost/api/generate-access', {
        method: 'POST',
        body: JSON.stringify({ code: 'gac_wrong' }),
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
      new Request('http://localhost/api/generate-access', {
        method: 'POST',
        body: JSON.stringify({ code: 'gac_old' }),
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
});
