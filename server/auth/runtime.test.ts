import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn((_environment?: Record<string, string | undefined>) => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  createGate: vi.fn(() => ({ gate: true })),
  createBetterAuth: vi.fn(() => ({ auth: true })),
}));

vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/enrollment/repository', () => ({
  createEnrollmentRepository: mocks.createRepository,
}));
vi.mock('./invitation-enrollment', () => ({
  createInvitationEnrollmentGate: mocks.createGate,
}));
vi.mock('./better-auth', () => ({ createBetterAuth: mocks.createBetterAuth }));

import { createRuntimeAuth, getRuntimeAuth, resetRuntimeAuthForTests } from './runtime';

const env = {
  DATABASE_URL: 'postgresql://user:pass@ep-example.neon.tech/app?sslmode=require',
  BETTER_AUTH_SECRET: 's'.repeat(48),
  BETTER_AUTH_URL: 'https://articles.example.com',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};

describe('auth runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeDatabase.mockImplementation((environment?: Record<string, string | undefined>) => {
      if (!environment?.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
      return { database: true };
    });
    resetRuntimeAuthForTests();
  });

  it('constructs Neon, invitation enforcement, and Better Auth from server environment', () => {
    expect(createRuntimeAuth(env)).toEqual({ auth: true });
    expect(mocks.getRuntimeDatabase).toHaveBeenCalledWith(env);
    expect(mocks.createRepository).toHaveBeenCalledWith({ database: true });
    expect(mocks.createGate).toHaveBeenCalledWith({ repository: { repository: true } });
    expect(mocks.createBetterAuth).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      enrollmentGate: { gate: true },
      environment: expect.objectContaining({ baseUrl: env.BETTER_AUTH_URL }),
    }));
  });

  it('fails closed when DATABASE_URL is absent', () => {
    expect(() => createRuntimeAuth({ ...env, DATABASE_URL: '' })).toThrow('DATABASE_URL');
    expect(mocks.createBetterAuth).not.toHaveBeenCalled();
  });

  it('lazily reuses one auth instance per Worker isolate', () => {
    const first = getRuntimeAuth(env);
    const second = getRuntimeAuth(env);

    expect(first).toBe(second);
    expect(mocks.createBetterAuth).toHaveBeenCalledTimes(1);
  });
});
