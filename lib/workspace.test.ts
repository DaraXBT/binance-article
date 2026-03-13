import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieValues = new Map<string, string>();

const cookiesMock = vi.fn(async () => ({
  get: (name: string) => {
    const value = cookieValues.get(name);
    return value ? { value } : undefined;
  },
  set: (name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0 || value === '') {
      cookieValues.delete(name);
      return;
    }

    cookieValues.set(name, value);
  },
}));

const prismaMock = {
  deckProject: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  workspaceSession: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  workspace: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

const generateAccessMock = {
  isGenerateAccessEnabled: vi.fn(() => false),
  getCurrentGenerateAccessState: vi.fn(async () => ({
    enabled: false,
    hasAccess: true,
    invalidReason: null,
    grantId: null,
  })),
};

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@/lib/session', () => ({
  getSessionId: vi.fn(async () => 'session-1'),
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));
vi.mock('@/lib/generate-access', () => generateAccessMock);

describe('workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    cookieValues.clear();
    prismaMock.deckProject.findMany.mockResolvedValue([]);
    prismaMock.workspace.create.mockResolvedValue({
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_created',
    });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    (
      global as typeof globalThis & {
        workspaceBackfillPromise?: Promise<void>;
      }
    ).workspaceBackfillPromise = undefined;
  });

  it('reports that a fresh session has no workspace without auto-creating one', async () => {
    prismaMock.workspaceSession.findUnique.mockResolvedValue(null);

    const { getWorkspaceBootstrap } = await import('@/lib/workspace');
    const bootstrap = await getWorkspaceBootstrap();

    expect(bootstrap).toEqual({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    });
    expect(prismaMock.workspace.create).not.toHaveBeenCalled();
  });

  it('creates a workspace explicitly and reveals its recovery key once', async () => {
    prismaMock.workspaceSession.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        workspace: {
          id: 'workspace-1',
          accessKeyPrefix: 'dwk_created',
        },
      });

    const { createWorkspaceForCurrentSession, getWorkspaceBootstrap } = await import('@/lib/workspace');
    const created = await createWorkspaceForCurrentSession();
    const firstBootstrap = await getWorkspaceBootstrap();
    const secondBootstrap = await getWorkspaceBootstrap();

    expect(created.workspace).toEqual({
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_created',
    });
    expect(created.recoveryKey).toMatch(/^dwk_/);
    expect(firstBootstrap).toEqual({
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_created',
      recoveryKey: created.recoveryKey,
      generateAccessEnabled: false,
      hasGenerationAccess: true,
      generationAccessInvalidReason: null,
    });
    expect(secondBootstrap).toEqual({
      hasWorkspace: true,
      workspaceId: 'workspace-1',
      accessKeyPrefix: 'dwk_created',
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: true,
      generationAccessInvalidReason: null,
    });
  });

  it('returns bootstrap data even when legacy backfill fails', async () => {
    prismaMock.deckProject.findMany.mockResolvedValue([{ sessionId: 'legacy-session' }]);
    prismaMock.$transaction.mockRejectedValue(new Error('SQLite write failed'));
    prismaMock.workspaceSession.findUnique.mockResolvedValue(null);

    const { getWorkspaceBootstrap } = await import('@/lib/workspace');
    const bootstrap = await getWorkspaceBootstrap();

    expect(bootstrap).toEqual({
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: false,
      hasGenerationAccess: false,
      generationAccessInvalidReason: null,
    });
  });

  it('attaches the current session when recovering a valid workspace key', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: 'workspace-2',
      accessKeyPrefix: 'dwk_saved',
    });
    cookieValues.set('deckforge_workspace_key_reveal', 'dwk_temp_key');

    const { recoverWorkspaceForCurrentSession } = await import('@/lib/workspace');
    const recovered = await recoverWorkspaceForCurrentSession('dwk_valid_key');

    expect(recovered).toEqual({
      id: 'workspace-2',
      accessKeyPrefix: 'dwk_saved',
    });
    expect(prismaMock.workspaceSession.upsert).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
      },
      update: {
        workspaceId: 'workspace-2',
      },
      create: {
        sessionId: 'session-1',
        workspaceId: 'workspace-2',
      },
    });
    expect(cookieValues.has('deckforge_workspace_key_reveal')).toBe(false);
  });
});
