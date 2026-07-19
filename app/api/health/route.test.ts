import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getRuntimeDatabase: vi.fn(),
  legacyPrismaQuery: vi.fn(),
}));

vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));

// Prevent the legacy implementation from opening a real connection during RED.
vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: mocks.legacyPrismaQuery },
}));

import { GET } from './route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([]);
    mocks.getRuntimeDatabase.mockReturnValue({ execute: mocks.execute });
    mocks.legacyPrismaQuery.mockResolvedValue([{ '?column?': 1 }]);
  });

  it('checks the Worker-native Neon/Drizzle connection', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getRuntimeDatabase).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.legacyPrismaQuery).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });

  it('returns a sanitized no-store degraded response when the database is unavailable', async () => {
    mocks.execute.mockRejectedValue(
      new Error('password=DO_NOT_EXPOSE host=private.internal')
    );

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toContain('degraded');
    expect(body).not.toContain('DO_NOT_EXPOSE');
    expect(body).not.toContain('private.internal');
  });
});
