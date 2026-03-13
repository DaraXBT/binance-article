import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  createDeckProject: vi.fn(),
  listDeckProjects: vi.fn(),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    sessionId: 'session-1',
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

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
vi.mock('@/server/modules/workspace/service', () => workspaceMock);

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
  });

  it('creates an article for the current workspace when generation access is unlocked', async () => {
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

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 'deck-1' });
    expect(dbMock.createDeckProject).toHaveBeenCalledWith(
      'Article title',
      'Article content',
      'Article description',
      'pixel-art',
      'workspace-1'
    );
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
});
