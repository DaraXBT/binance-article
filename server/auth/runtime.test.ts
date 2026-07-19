import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  createGate: vi.fn(() => ({ gate: true })),
  createBetterAuth: vi.fn(() => ({ auth: true })),
}));

vi.mock('@/server/db/client', () => ({ createDatabase: mocks.createDatabase }));
vi.mock('./invitation-repository', () => ({
  createDrizzleInvitationRepository: mocks.createRepository,
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
  TELEGRAM_CLIENT_ID: 'telegram-id',
  TELEGRAM_CLIENT_SECRET: 'telegram-secret',
};

describe('auth runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeAuthForTests();
  });

  it('constructs Neon, invitation enforcement, and Better Auth from server environment', () => {
    expect(createRuntimeAuth(env)).toEqual({ auth: true });
    expect(mocks.createDatabase).toHaveBeenCalledWith(env.DATABASE_URL);
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
