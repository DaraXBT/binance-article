import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

describe('server env fallback', () => {
  const env = process.env as NodeJS.ProcessEnv & { NODE_ENV?: string };
  const originalNodeEnv = env.NODE_ENV;
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    env.NODE_ENV = 'development';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    existsSyncMock.mockImplementation((filePath: string) => filePath.endsWith('.env.vercel.local'));
    readFileSyncMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('.env.vercel.local')) {
        return 'BLOB_READ_WRITE_TOKEN=blob-token-from-vercel-local\n';
      }

      return '';
    });
  });

  afterEach(async () => {
    if (originalBlobToken) {
      process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    } else {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
    env.NODE_ENV = originalNodeEnv;
    const { resetLocalEnvCacheForTests } = await import('@/lib/server-env');
    resetLocalEnvCacheForTests();
  });

  it('falls back to .env.vercel.local in local development when process env is missing', async () => {
    const { getServerEnv, resetLocalEnvCacheForTests } = await import('@/lib/server-env');
    resetLocalEnvCacheForTests();

    expect(getServerEnv('BLOB_READ_WRITE_TOKEN')).toBe('blob-token-from-vercel-local');
  });

  it('prefers process env over local file fallback', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-token-from-process';
    const { getServerEnv, resetLocalEnvCacheForTests } = await import('@/lib/server-env');
    resetLocalEnvCacheForTests();

    expect(getServerEnv('BLOB_READ_WRITE_TOKEN')).toBe('blob-token-from-process');
  });
});
