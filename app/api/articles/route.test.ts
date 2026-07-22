import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  createDeckProject: vi.fn(),
  listDeckProjects: vi.fn(),
};

const authMock = {
  requireActiveUser: vi.fn(async () => ({ id: 'user-1', sessionId: 'session-1' })),
};

const workspaceMock = {
  requireActorWorkspace: vi.fn(async () => ({ id: 'workspace-1', accessKeyPrefix: 'acct_test' })),
};

const runtimeMock = { getRuntimeDatabase: vi.fn(() => ({ db: true })) };
const bodyMock = {
  readBoundedJson: vi.fn(async () => ({
    title: 'Article title',
    description: 'Article description',
    content: 'Article content',
    illustrationStyle: 'pixel-art',
  })),
};
const originMock = { assertAllowedOrigin: vi.fn() };

const generateAccessMock = {
  isGenerateAccessEnabled: vi.fn<() => boolean>(() => false),
  getRequestGenerateAccessState: vi.fn<
    () => Promise<{
      enabled: boolean;
      hasAccess: boolean;
      invalidReason: string | null;
      grantId: string | null;
    }>
  >(async () => ({
    enabled: false,
    hasAccess: true,
    invalidReason: null,
    grantId: null,
  })),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/generate-access', () => generateAccessMock);
vi.mock('@/server/auth/authorization', () => authMock);
vi.mock('@/server/modules/workspace/membership', () => workspaceMock);
vi.mock('@/server/db/runtime', () => runtimeMock);
vi.mock('@/server/http/request-body', () => bodyMock);
vi.mock('@/server/auth/origin', () => originMock);

describe('POST /api/articles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(false);
    generateAccessMock.getRequestGenerateAccessState.mockResolvedValue({
      enabled: false,
      hasAccess: true,
      invalidReason: null,
      grantId: null,
    });
    dbMock.createDeckProject.mockResolvedValue({ id: 'deck-1' });
    dbMock.listDeckProjects.mockResolvedValue([{ id: 'deck-1' }]);
    authMock.requireActiveUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    workspaceMock.requireActorWorkspace.mockResolvedValue({
      id: 'workspace-1', accessKeyPrefix: 'acct_test',
    });
    bodyMock.readBoundedJson.mockResolvedValue({
      title: 'Article title',
      description: 'Article description',
      content: 'Article content',
      illustrationStyle: 'pixel-art',
    });
  });

  it('creates an article for the current workspace when generation access is unlocked', async () => {
    const { POST } = await import('@/app/api/articles/route');
    const request = new Request('https://articles.example.com/api/articles', {
      method: 'POST', headers: { origin: 'https://articles.example.com' },
      body: '{}',
    });
    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 'deck-1' });
    expect(originMock.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(authMock.requireActiveUser).toHaveBeenCalledWith(request);
    expect(workspaceMock.requireActorWorkspace).toHaveBeenCalledWith({ db: true }, 'user-1');
    expect(dbMock.createDeckProject).toHaveBeenCalledWith(
      'Article title',
      'Article content',
      'Article description',
      'pixel-art',
      'workspace-1',
      undefined,
    );
  });

  it('persists a new Binance illustration style without remapping it', async () => {
    bodyMock.readBoundedJson.mockResolvedValueOnce({
      title: 'Article title',
      description: 'Article description',
      content: 'Article content',
      illustrationStyle: 'binance-briefing',
    });
    const { POST } = await import('@/app/api/articles/route');
    const response = await POST(new Request('https://articles.example.com/api/articles', {
      method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}',
    }) as never);

    expect(response.status).toBe(201);
    expect(dbMock.createDeckProject).toHaveBeenCalledWith(
      'Article title',
      'Article content',
      'Article description',
      'binance-briefing',
      'workspace-1',
      undefined,
    );
  });

  it('passes a bounded UUID idempotency key into workspace-scoped article creation', async () => {
    const { POST } = await import('@/app/api/articles/route');
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';
    const request = new Request('https://articles.example.com/api/articles', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'Idempotency-Key': idempotencyKey,
      },
      body: '{}',
    });

    const response = await POST(request as never);

    expect(response.status).toBe(201);
    expect(dbMock.createDeckProject).toHaveBeenCalledWith(
      'Article title',
      'Article content',
      'Article description',
      'pixel-art',
      'workspace-1',
      idempotencyKey,
    );
  });

  it('rejects malformed idempotency keys before article persistence', async () => {
    const { POST } = await import('@/app/api/articles/route');
    const response = await POST(new Request('https://articles.example.com/api/articles', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'Idempotency-Key': 'not-a-uuid',
      },
      body: '{}',
    }) as never);

    expect(response.status).toBe(400);
    expect(dbMock.createDeckProject).not.toHaveBeenCalled();
  });

  it('lists only the authenticated account workspace', async () => {
    const { GET } = await import('@/app/api/articles/route');
    const request = new Request('https://articles.example.com/api/articles');
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: 'deck-1' }]);
    expect(authMock.requireActiveUser).toHaveBeenCalledWith(request);
    expect(dbMock.listDeckProjects).toHaveBeenCalledWith('workspace-1', 20);
  });

  it('returns 403 when generation access is enabled but not unlocked', async () => {
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(true);
    generateAccessMock.getRequestGenerateAccessState.mockResolvedValue({
      enabled: true,
      hasAccess: false,
      invalidReason: 'missing',
      grantId: null,
    });

    const { POST } = await import('@/app/api/articles/route');
    const response = await POST(
      new Request('http://localhost/api/articles', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Article title',
          description: 'Article description',
          content: 'Article content',
          illustrationStyle: 'pixel-art',
        }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'GENERATE_ACCESS_REQUIRED',
      })
    );
    expect(dbMock.createDeckProject).not.toHaveBeenCalled();
  });

  it('authenticates before parsing article content or touching tenant data', async () => {
    const { AppError } = await import('@/server/http/errors');
    authMock.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    const { POST } = await import('@/app/api/articles/route');
    const response = await POST(new Request('https://articles.example.com/api/articles', {
      method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}',
    }) as never);
    expect(response.status).toBe(401);
    expect(bodyMock.readBoundedJson).not.toHaveBeenCalled();
    expect(workspaceMock.requireActorWorkspace).not.toHaveBeenCalled();
  });
});
