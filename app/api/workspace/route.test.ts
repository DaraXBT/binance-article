import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceMock = {
  getWorkspaceBootstrap: vi.fn(),
  recoverWorkspaceForCurrentSession: vi.fn(),
};

vi.mock('@/lib/workspace', () => workspaceMock);

describe('/api/workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the current workspace bootstrap payload', async () => {
    workspaceMock.getWorkspaceBootstrap.mockResolvedValue({
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_123456',
      recoveryKey: 'dwk_1234567890',
    });

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_123456',
      recoveryKey: 'dwk_1234567890',
    });
  });

  it('recovers a workspace for the current session', async () => {
    workspaceMock.recoverWorkspaceForCurrentSession.mockResolvedValue({
      id: 'workspace-2',
      accessKeyPrefix: 'dwk_abcdef',
    });

    const { POST } = await import('@/app/api/workspace/recover/route');
    const response = await POST(
      new Request('http://localhost/api/workspace/recover', {
        method: 'POST',
        body: JSON.stringify({ accessKey: 'dwk_abcdef123' }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      workspaceId: 'workspace-2',
      accessKeyPrefix: 'dwk_abcdef',
    });
  });

  it('rejects an invalid access key without leaking workspace state', async () => {
    workspaceMock.recoverWorkspaceForCurrentSession.mockResolvedValue(null);

    const { POST } = await import('@/app/api/workspace/recover/route');
    const response = await POST(
      new Request('http://localhost/api/workspace/recover', {
        method: 'POST',
        body: JSON.stringify({ accessKey: 'invalid-key' }),
      }) as never
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid access key' });
  });
});
