import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceMock = {
  getWorkspaceBootstrap: vi.fn(),
  createWorkspaceForCurrentSession: vi.fn(),
  recoverWorkspaceForCurrentSession: vi.fn(),
};

vi.mock('@/lib/workspace', () => workspaceMock);

describe('/api/workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace status without auto-creating for a fresh session', async () => {
    workspaceMock.getWorkspaceBootstrap.mockResolvedValue({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
    });

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
    });
  });

  it('returns a sanitized structured error when workspace bootstrap fails', async () => {
    workspaceMock.getWorkspaceBootstrap.mockRejectedValue(new Error('Prisma failed to open SQLite database'));

    const { GET } = await import('@/app/api/workspace/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to fetch workspace',
      code: 'WORKSPACE_BOOTSTRAP_FAILED',
    });
  });

  it('creates a workspace explicitly for the current session', async () => {
    workspaceMock.createWorkspaceForCurrentSession.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        accessKeyPrefix: 'dwk_123456',
      },
      recoveryKey: 'dwk_1234567890',
    });

    const { POST } = await import('@/app/api/workspace/route');
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
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
