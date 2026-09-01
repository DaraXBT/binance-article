import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockGeminiRestError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(input: { statusCode: number; code: string }) {
      super('Gemini provider request failed.');
      this.name = 'GeminiRestError';
      this.statusCode = input.statusCode;
      this.code = input.code;
    }
  }

  return {
    requireActiveUser: vi.fn(async () => ({ id: 'owner_1', sessionId: 'session_1' })),
    requireActorWorkspaceOwner: vi.fn(async () => ({
      id: 'workspace_1', workspaceRole: 'owner' as const,
    })),
    getRuntimeDatabase: vi.fn(() => ({ db: true })),
    assertAllowedOrigin: vi.fn(),
    readBoundedJson: vi.fn(async () => ({ apiKey: 'workspace-key-with-enough-length' })),
    consumeAtomicRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      resetAt: new Date('2026-07-26T00:15:00.000Z'),
    })),
    findOwned: vi.fn(),
    saveOwned: vi.fn(),
    recordValidationOwned: vi.fn(),
    changeSourceOwned: vi.fn(),
    deleteOwned: vi.fn(),
    validateGeminiApiKey: vi.fn(async () => ({ models: ['text'] })),
    GeminiRestError: MockGeminiRestError,
    parseAiCredentialKeyring: vi.fn(async () => ({ activeKeyId: 'v1', keys: new Map() })),
    encryptWorkspaceAiCredential: vi.fn(async () => ({
      ciphertext: 'ciphertext-value', nonce: 'nonce-value', encryptionKeyId: 'v1',
    })),
    decryptWorkspaceAiCredential: vi.fn(async () => 'workspace-key-with-enough-length'),
  };
});

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/modules/workspace/membership', () => ({
  requireActorWorkspaceOwner: mocks.requireActorWorkspaceOwner,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/http/request-body', () => ({ readBoundedJson: mocks.readBoundedJson }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/modules/workspace/ai-credential-repository', () => ({
  createWorkspaceAiCredentialRepository: () => ({
    findOwned: mocks.findOwned,
    saveOwned: mocks.saveOwned,
    recordValidationOwned: mocks.recordValidationOwned,
    changeSourceOwned: mocks.changeSourceOwned,
    deleteOwned: mocks.deleteOwned,
  }),
}));
vi.mock('@/server/integrations/gemini-rest', () => ({
  validateGeminiApiKey: mocks.validateGeminiApiKey,
  GeminiRestError: mocks.GeminiRestError,
}));
vi.mock('@/server/security/ai-credential-crypto', () => ({
  parseAiCredentialKeyring: mocks.parseAiCredentialKeyring,
  encryptWorkspaceAiCredential: mocks.encryptWorkspaceAiCredential,
  decryptWorkspaceAiCredential: mocks.decryptWorkspaceAiCredential,
}));
vi.mock('@/server/integrations/workspace-gemini-credential', () => ({
  normalizeGeminiApiKey: (value: string) => value.trim(),
}));

function record(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-26T00:00:00.000Z');
  return {
    id: 'credential_1',
    workspaceId: 'workspace_1',
    provider: 'gemini' as const,
    ciphertext: 'stored-ciphertext',
    nonce: 'stored-nonce',
    encryptionKeyId: 'v1',
    enabled: false,
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('/api/workspace/ai-credential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CREDENTIAL_KEYRING = JSON.stringify({ v1: 'key' });
    process.env.AI_CREDENTIAL_ACTIVE_KEY_ID = 'v1';
    mocks.validateGeminiApiKey.mockResolvedValue({ models: ['text'] });
    mocks.findOwned.mockResolvedValue(null);
    mocks.decryptWorkspaceAiCredential.mockResolvedValue('workspace-key-with-enough-length');
    mocks.saveOwned.mockResolvedValue({ operation: 'created', record: record() });
    mocks.recordValidationOwned.mockResolvedValue(record({ validatedAt: new Date('2026-07-26T00:20:00.000Z') }));
    mocks.changeSourceOwned.mockResolvedValue({ changed: true, record: record({ enabled: true }) });
    mocks.deleteOwned.mockResolvedValue({ deleted: true });
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true, remaining: 9, resetAt: new Date('2026-07-26T00:15:00.000Z'),
    });
  });

  it('returns only a sanitized owner status', async () => {
    mocks.findOwned.mockResolvedValue(record({ enabled: true }));
    const { GET } = await import('./route');
    const response = await GET(new Request('https://example.test/api/workspace/ai-credential') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: 'gemini', configured: true, activeSource: 'workspace',
    });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|nonce|encryptionKeyId|apiKey|stored-ciphertext/i);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('validates before saving and keeps the first saved key on platform source', async () => {
    const request = new Request('https://example.test/api/workspace/ai-credential', {
      method: 'PUT',
      headers: { origin: 'https://example.test' },
      body: JSON.stringify({ apiKey: 'workspace-key-with-enough-length' }),
    });
    const { PUT } = await import('./route');
    const response = await PUT(request as never);

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledOnce();
    expect(mocks.validateGeminiApiKey).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'workspace-key-with-enough-length', textModel: 'gemini-2.5-flash',
    }));
    expect(mocks.saveOwned).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1',
      ciphertext: 'ciphertext-value', nonce: 'nonce-value', encryptionKeyId: 'v1',
    }));
  });

  it('stops before Gemini when the credential rate limit is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValue({
      allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000),
    });
    const { PUT } = await import('./route');
    const response = await PUT(new Request('https://example.test/api/workspace/ai-credential', {
      method: 'PUT', headers: { origin: 'https://example.test' }, body: '{}',
    }) as never);

    expect(response.status).toBe(429);
    expect(mocks.validateGeminiApiKey).not.toHaveBeenCalled();
    expect(mocks.saveOwned).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', { statusCode: 502, code: 'GEMINI_NETWORK_ERROR' }, 503, 'GEMINI_CONNECTION_UNAVAILABLE'],
    ['a provider outage', { statusCode: 503, code: 'GEMINI_PROVIDER_ERROR' }, 503, 'GEMINI_CONNECTION_UNAVAILABLE'],
    ['a key or text-model permission failure', { statusCode: 403, code: 'GEMINI_PROVIDER_ERROR' }, 400, 'GEMINI_CREDENTIAL_INVALID'],
    ['a provider rate limit', { statusCode: 429, code: 'GEMINI_PROVIDER_ERROR' }, 429, 'RATE_LIMITED'],
  ] as const)('classifies %s without saving the key', async (_label, providerError, status, code) => {
    mocks.validateGeminiApiKey.mockRejectedValue(new mocks.GeminiRestError(providerError));
    const { PUT } = await import('./route');
    const response = await PUT(new Request('https://example.test/api/workspace/ai-credential', {
      method: 'PUT', headers: { origin: 'https://example.test' }, body: '{}',
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ code });
    expect(mocks.saveOwned).not.toHaveBeenCalled();
  });

  it('fails closed when testing a stored key cannot decrypt', async () => {
    mocks.findOwned.mockResolvedValue(record({ enabled: true }));
    mocks.decryptWorkspaceAiCredential.mockRejectedValue(new Error('tampered ciphertext'));
    const { POST } = await import('./route');
    const response = await POST(new Request('https://example.test/api/workspace/ai-credential', {
      method: 'POST', headers: { origin: 'https://example.test' },
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: 'WORKSPACE_GEMINI_CONNECTION_INVALID' });
    expect(JSON.stringify(body)).not.toContain('tampered');
    expect(mocks.validateGeminiApiKey).not.toHaveBeenCalled();
  });

  it('revalidates before activating the workspace source', async () => {
    mocks.findOwned.mockResolvedValue(record({ enabled: false }));
    mocks.readBoundedJson.mockResolvedValue({ source: 'workspace' } as never);
    const { PATCH } = await import('./route');
    const response = await PATCH(new Request('https://example.test/api/workspace/ai-credential', {
      method: 'PATCH', headers: { origin: 'https://example.test' }, body: JSON.stringify({ source: 'workspace' }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.validateGeminiApiKey).toHaveBeenCalledOnce();
    expect(mocks.changeSourceOwned).toHaveBeenCalledWith(expect.objectContaining({
      source: 'workspace', validatedAt: expect.any(Date),
    }));
  });

  it('returns to platform and deletes the encrypted copy without exposing storage fields', async () => {
    mocks.findOwned.mockResolvedValue(record({ enabled: true }));
    const { DELETE } = await import('./route');
    const response = await DELETE(new Request('https://example.test/api/workspace/ai-credential', {
      method: 'DELETE', headers: { origin: 'https://example.test' },
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      provider: 'gemini', configured: false, activeSource: 'platform', validatedAt: null, updatedAt: null,
    });
    expect(mocks.deleteOwned).toHaveBeenCalledOnce();
    expect(mocks.consumeAtomicRateLimit).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|nonce|encryptionKeyId|apiKey/i);
  });
});
