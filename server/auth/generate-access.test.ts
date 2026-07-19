import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { repositoryMock } = vi.hoisted(() => ({
  repositoryMock: {
    findById: vi.fn(),
    findByCodeHash: vi.fn(),
    consumeUnbound: vi.fn(),
  },
}));

vi.mock('./generate-access-repository', () => ({
  createGenerationAccessGrantRepository: vi.fn(() => repositoryMock),
}));
vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
}));
import {
  consumeGenerateAccessGrant,
  createGenerateAccessCode,
  getRequestGenerateAccessState,
  hashGenerateAccessCode,
} from './generate-access';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant_1',
    status: 'active' as const,
    boundWorkspaceId: null,
    boundSessionId: null,
    envCodeHash: '',
    ...overrides,
  };
}

describe('generation access security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GENERATE_ACCESS_CODE = 'rotation-secret';
    repositoryMock.findById.mockResolvedValue(null);
    repositoryMock.findByCodeHash.mockResolvedValue(null);
    repositoryMock.consumeUnbound.mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.GENERATE_ACCESS_CODE;
    vi.restoreAllMocks();
  });

  it('hashes the trimmed code through Web Crypto SHA-256', async () => {
    const digestSpy = vi.spyOn(crypto.subtle, 'digest');

    await expect(hashGenerateAccessCode('  access-code  ')).resolves.toBe(
      await sha256('access-code'),
    );
    expect(digestSpy).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
  });

  it('generates a 144-bit code through Web Crypto randomness', () => {
    const randomSpy = vi.spyOn(crypto, 'getRandomValues');

    expect(createGenerateAccessCode()).toMatch(/^gac_[a-f0-9]{36}$/);
    expect(randomSpy).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it('atomically binds a valid unbound grant to the authenticated workspace and session', async () => {
    const envCodeHash = await sha256('rotation-secret');
    repositoryMock.findByCodeHash.mockResolvedValue(grant({ envCodeHash }));
    repositoryMock.consumeUnbound.mockResolvedValue(true);

    await expect(consumeGenerateAccessGrant({
      code: 'gac_valid', workspaceId: 'workspace_1', sessionId: 'session_1',
    })).resolves.toEqual({ ok: true, grantId: 'grant_1' });
    expect(repositoryMock.findByCodeHash).toHaveBeenCalledWith(await sha256('gac_valid'));
    expect(repositoryMock.consumeUnbound).toHaveBeenCalledWith(expect.objectContaining({
      grantId: 'grant_1',
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      envCodeHash,
      now: expect.any(Date),
    }));
  });

  it('is idempotent only when the same workspace and auth session already hold the grant', async () => {
    const envCodeHash = await sha256('rotation-secret');
    repositoryMock.findByCodeHash.mockResolvedValue(grant({
      status: 'consumed', envCodeHash,
      boundWorkspaceId: 'workspace_1', boundSessionId: 'session_1',
    }));

    await expect(consumeGenerateAccessGrant({
      code: 'gac_valid', workspaceId: 'workspace_1', sessionId: 'session_1',
    })).resolves.toEqual({ ok: true, grantId: 'grant_1' });
    expect(repositoryMock.consumeUnbound).not.toHaveBeenCalled();
  });

  it('does not expose whether a valid grant belongs to another session', async () => {
    const envCodeHash = await sha256('rotation-secret');
    repositoryMock.findByCodeHash.mockResolvedValue(grant({
      status: 'consumed', envCodeHash,
      boundWorkspaceId: 'workspace_1', boundSessionId: 'other_session',
    }));

    await expect(consumeGenerateAccessGrant({
      code: 'gac_valid', workspaceId: 'workspace_1', sessionId: 'session_1',
    })).resolves.toEqual({ ok: false, reason: 'already_used' });
  });

  it('re-reads a lost consume race and accepts only the same resulting binding', async () => {
    const envCodeHash = await sha256('rotation-secret');
    repositoryMock.findByCodeHash.mockResolvedValue(grant({ envCodeHash }));
    repositoryMock.consumeUnbound.mockResolvedValue(false);
    repositoryMock.findById.mockResolvedValue(grant({
      status: 'consumed', envCodeHash,
      boundWorkspaceId: 'workspace_1', boundSessionId: 'session_1',
    }));

    await expect(consumeGenerateAccessGrant({
      code: 'gac_valid', workspaceId: 'workspace_1', sessionId: 'session_1',
    })).resolves.toEqual({ ok: true, grantId: 'grant_1' });
  });

  it('resolves request state from the Drizzle repository without returning hashes', async () => {
    const envCodeHash = await sha256('rotation-secret');
    repositoryMock.findById.mockResolvedValue(grant({
      status: 'consumed', envCodeHash,
      boundWorkspaceId: 'workspace_1', boundSessionId: 'session_1',
    }));
    const request = {
      cookies: { get: vi.fn(() => ({ value: 'grant_1' })) },
    };

    await expect(getRequestGenerateAccessState(request as never, {
      workspaceId: 'workspace_1', sessionId: 'session_1',
    })).resolves.toEqual({
      enabled: true, hasAccess: true, invalidReason: null, grantId: 'grant_1',
    });
  });
});
