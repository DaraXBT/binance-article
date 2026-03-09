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

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@/lib/session', () => ({
  getSessionId: vi.fn(async () => 'session-1'),
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

describe('workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieValues.clear();
    prismaMock.deckProject.findMany.mockResolvedValue([]);
    prismaMock.workspace.create.mockImplementation(async ({ data }) => ({
      id: 'workspace-1',
      accessKeyPrefix: data.accessKeyPrefix,
    }));
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    (
      global as typeof globalThis & {
        workspaceBackfillPromise?: Promise<void>;
      }
    ).workspaceBackfillPromise = undefined;
  });

  it('reveals the recovery key once when a workspace is first created', async () => {
    prismaMock.workspaceSession.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        workspace: {
          id: 'workspace-1',
          accessKeyPrefix: 'dwk_prefix',
        },
      });

    const { getWorkspaceBootstrap } = await import('@/lib/workspace');
    const firstBootstrap = await getWorkspaceBootstrap();
    const secondBootstrap = await getWorkspaceBootstrap();

    expect(firstBootstrap.workspaceId).toBe('workspace-1');
    expect(firstBootstrap.recoveryKey).toMatch(/^dwk_/);
    expect(secondBootstrap.recoveryKey).toBeNull();
  });

  it('attaches the current session when recovering a valid workspace key', async () => {
    prismaMock.workspaceSession.findUnique.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
        accessKeyPrefix: 'dwk_prefix',
      },
    });
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
