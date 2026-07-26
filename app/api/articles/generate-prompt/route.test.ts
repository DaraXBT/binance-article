import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user-1', sessionId: 'session-1' })),
  requireActorWorkspace: vi.fn(async () => ({ id: 'workspace-1' })),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  readBoundedJson: vi.fn(async () => ({ title: 'Bitcoin adoption' })),
  assertAllowedOrigin: vi.fn(),
  isGenerateAccessEnabled: vi.fn(() => false),
  getRequestGenerateAccessState: vi.fn(async () => ({
    hasAccess: true, invalidReason: null,
  })),
  generatePlainTextWithGemini: vi.fn(async () => 'A bounded generated prompt.'),
  normalizeGeminiError: vi.fn(),
  resolveGeminiTextConfig: vi.fn((apiKey: string) => ({
    apiKey,
    model: 'gemini-text-model',
  })),
  resolveWorkspaceGeminiCredential: vi.fn(async () => ({
    provider: 'gemini' as const,
    source: 'platform' as 'platform' | 'workspace',
    apiKey: 'platform-key-with-enough-length',
  })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 19,
    resetAt: new Date(Date.now() + 60_000),
  })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/modules/workspace/membership', () => ({
  requireActorWorkspace: mocks.requireActorWorkspace,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/request-body', () => ({ readBoundedJson: mocks.readBoundedJson }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/lib/generate-access', () => ({
  isGenerateAccessEnabled: mocks.isGenerateAccessEnabled,
  getRequestGenerateAccessState: mocks.getRequestGenerateAccessState,
}));
vi.mock('@/lib/gemini', () => ({
  generatePlainTextWithGemini: mocks.generatePlainTextWithGemini,
  normalizeGeminiError: mocks.normalizeGeminiError,
  resolveGeminiTextConfig: mocks.resolveGeminiTextConfig,
}));
vi.mock('@/server/integrations/workspace-gemini-credential', () => ({
  resolveWorkspaceGeminiCredential: mocks.resolveWorkspaceGeminiCredential,
}));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));

describe('POST /api/articles/generate-prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    mocks.requireActorWorkspace.mockResolvedValue({ id: 'workspace-1' });
    mocks.readBoundedJson.mockResolvedValue({ title: 'Bitcoin adoption' });
    mocks.isGenerateAccessEnabled.mockReturnValue(false);
    mocks.generatePlainTextWithGemini.mockResolvedValue('A bounded generated prompt.');
    mocks.normalizeGeminiError.mockReset();
    mocks.resolveWorkspaceGeminiCredential.mockResolvedValue({
      provider: 'gemini',
      source: 'platform',
      apiKey: 'platform-key-with-enough-length',
    });
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date(Date.now() + 60_000),
    });
  });

  it('generates only after active-user and workspace authorization', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://articles.example.com/api/articles/generate-prompt', {
      method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}',
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ prompt: 'A bounded generated prompt.' });
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.requireActorWorkspace).toHaveBeenCalledWith({ db: true }, 'user-1');
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { db: true },
      key: 'generate-prompt:user-1',
      limit: 20,
      windowMs: 60 * 60 * 1_000,
    }));
    expect(mocks.generatePlainTextWithGemini).toHaveBeenCalledOnce();
    expect(mocks.resolveWorkspaceGeminiCredential).toHaveBeenCalledWith({
      database: { db: true },
      workspaceId: 'workspace-1',
      environment: process.env,
    });
    expect(mocks.generatePlainTextWithGemini).toHaveBeenCalledWith(
      expect.any(String),
      { apiKey: 'platform-key-with-enough-length', model: 'gemini-text-model' },
    );
  });

  it('rejects an oversized topic before invoking the AI provider', async () => {
    mocks.readBoundedJson.mockResolvedValue({ title: 'x'.repeat(201) });
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/articles/generate-prompt',
      { method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}' },
    ) as never);
    expect(response.status).toBe(400);
    expect(mocks.generatePlainTextWithGemini).not.toHaveBeenCalled();
  });

  it('authenticates before reading a topic or touching Gemini', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/articles/generate-prompt',
      { method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}' },
    ) as never);
    expect(response.status).toBe(401);
    expect(mocks.readBoundedJson).not.toHaveBeenCalled();
    expect(mocks.generatePlainTextWithGemini).not.toHaveBeenCalled();
  });

  it('returns 429 before invoking Gemini when the actor suggestion budget is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/articles/generate-prompt',
      { method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}' },
    ) as never);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(mocks.generatePlainTextWithGemini).not.toHaveBeenCalled();
    expect(mocks.resolveWorkspaceGeminiCredential).not.toHaveBeenCalled();
  });

  it('keeps workspace quota failures source-aware', async () => {
    mocks.resolveWorkspaceGeminiCredential.mockResolvedValue({
      provider: 'gemini', source: 'workspace', apiKey: 'workspace-key-with-enough-length',
    });
    mocks.generatePlainTextWithGemini.mockRejectedValueOnce(new Error('provider body must not escape'));
    mocks.normalizeGeminiError.mockReturnValueOnce({
      statusCode: 429,
      message: 'Gemini API quota exceeded. Ask the workspace owner to test or replace the Gemini key, or switch to platform credits.',
    });
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/articles/generate-prompt',
      { method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}' },
    ) as never);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GEMINI_QUOTA_EXCEEDED',
      error: expect.stringContaining('workspace owner'),
    });
    expect(mocks.normalizeGeminiError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to generate the prompt.',
      { source: 'workspace', model: 'gemini-text-model' },
    );
  });

  it('turns workspace authentication failures into an actionable connection error', async () => {
    mocks.resolveWorkspaceGeminiCredential.mockResolvedValue({
      provider: 'gemini', source: 'workspace', apiKey: 'workspace-key-with-enough-length',
    });
    mocks.generatePlainTextWithGemini.mockRejectedValueOnce(new Error('provider secret must not escape'));
    mocks.normalizeGeminiError.mockReturnValueOnce({
      statusCode: 403,
      message: 'The workspace Gemini connection needs attention. Ask the workspace owner to test or replace the Gemini key, or switch to platform credits.',
    });
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/articles/generate-prompt',
      { method: 'POST', headers: { origin: 'https://articles.example.com' }, body: '{}' },
    ) as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
      error: expect.stringContaining('needs attention'),
    });
  });
});
