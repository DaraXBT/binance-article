import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';

import prisma from '@/lib/prisma';
import { getSessionId } from '@/lib/session';

const WORKSPACE_RECOVERY_COOKIE_NAME = 'deckforge_workspace_key_reveal';
const WORKSPACE_RECOVERY_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

declare global {
  // eslint-disable-next-line no-var
  var workspaceBackfillPromise: Promise<void> | undefined;
}

export interface CurrentWorkspace {
  id: string;
  accessKeyPrefix: string;
}

function createRecoveryAccessKey() {
  const raw = randomBytes(18).toString('hex');
  const accessKey = `dwk_${raw}`;

  return {
    accessKey,
    accessKeyHash: hashAccessKey(accessKey),
    accessKeyPrefix: accessKey.slice(0, 12),
  };
}

export function hashAccessKey(accessKey: string) {
  return createHash('sha256').update(accessKey.trim()).digest('hex');
}

async function setPendingWorkspaceRecoveryKey(accessKey: string) {
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_RECOVERY_COOKIE_NAME, accessKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: WORKSPACE_RECOVERY_COOKIE_MAX_AGE,
    path: '/',
  });
}

async function clearPendingWorkspaceRecoveryKey() {
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_RECOVERY_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

async function consumePendingWorkspaceRecoveryKey() {
  const cookieStore = await cookies();
  const pending = cookieStore.get(WORKSPACE_RECOVERY_COOKIE_NAME)?.value ?? null;

  if (pending) {
    await clearPendingWorkspaceRecoveryKey();
  }

  return pending;
}

async function runLegacyWorkspaceBackfill(currentSessionId: string) {
  const legacySessions = await prisma.deckProject.findMany({
    where: {
      workspaceId: null,
    },
    select: {
      sessionId: true,
    },
    distinct: ['sessionId'],
  });

  if (legacySessions.length === 0) {
    return;
  }

  let pendingAccessKey: string | null = null;

  await prisma.$transaction(async (tx) => {
    for (const legacyEntry of legacySessions) {
      const legacySessionId = legacyEntry.sessionId;

      const existingSession =
        legacySessionId.length > 0
          ? await tx.workspaceSession.findUnique({
              where: { sessionId: legacySessionId },
            })
          : null;

      let workspaceId = existingSession?.workspaceId ?? null;

      if (!workspaceId) {
        const generated = createRecoveryAccessKey();
        const workspace = await tx.workspace.create({
          data: {
            accessKeyHash: generated.accessKeyHash,
            accessKeyPrefix: generated.accessKeyPrefix,
          },
        });

        workspaceId = workspace.id;

        if (legacySessionId.length > 0) {
          await tx.workspaceSession.create({
            data: {
              sessionId: legacySessionId,
              workspaceId,
            },
          });
        }

        if (legacySessionId === currentSessionId) {
          pendingAccessKey = generated.accessKey;
        }
      }

      await tx.deckProject.updateMany({
        where: {
          workspaceId: null,
          sessionId: legacySessionId,
        },
        data: {
          workspaceId,
        },
      });
    }
  });

  if (pendingAccessKey) {
    await setPendingWorkspaceRecoveryKey(pendingAccessKey);
  }
}

async function ensureLegacyWorkspacesBackfilled(currentSessionId: string) {
  if (!global.workspaceBackfillPromise) {
    global.workspaceBackfillPromise = runLegacyWorkspaceBackfill(currentSessionId).catch((error) => {
      global.workspaceBackfillPromise = undefined;
      throw error;
    });
  }

  await global.workspaceBackfillPromise;
}

export async function getCurrentWorkspace() {
  const sessionId = await getSessionId();
  await ensureLegacyWorkspacesBackfilled(sessionId);

  const existingSession = await prisma.workspaceSession.findUnique({
    where: { sessionId },
    include: {
      workspace: true,
    },
  });

  if (existingSession?.workspace) {
    return {
      sessionId,
      workspace: {
        id: existingSession.workspace.id,
        accessKeyPrefix: existingSession.workspace.accessKeyPrefix,
      } satisfies CurrentWorkspace,
    };
  }

  const generated = createRecoveryAccessKey();
  try {
    const workspace = await prisma.workspace.create({
      data: {
        accessKeyHash: generated.accessKeyHash,
        accessKeyPrefix: generated.accessKeyPrefix,
        sessions: {
          create: {
            sessionId,
          },
        },
      },
    });

    await setPendingWorkspaceRecoveryKey(generated.accessKey);

    return {
      sessionId,
      workspace: {
        id: workspace.id,
        accessKeyPrefix: workspace.accessKeyPrefix,
      } satisfies CurrentWorkspace,
    };
  } catch (error) {
    const concurrentSession = await prisma.workspaceSession.findUnique({
      where: { sessionId },
      include: {
        workspace: true,
      },
    });

    if (concurrentSession?.workspace) {
      return {
        sessionId,
        workspace: {
          id: concurrentSession.workspace.id,
          accessKeyPrefix: concurrentSession.workspace.accessKeyPrefix,
        } satisfies CurrentWorkspace,
      };
    }

    throw error;
  }
}

export async function getWorkspaceBootstrap() {
  const { workspace } = await getCurrentWorkspace();
  const recoveryKey = await consumePendingWorkspaceRecoveryKey();

  return {
    workspaceId: workspace.id,
    accessKeyPrefix: workspace.accessKeyPrefix,
    recoveryKey,
  };
}

export async function recoverWorkspaceForCurrentSession(accessKey: string) {
  const trimmedKey = accessKey.trim();
  if (!trimmedKey) {
    return null;
  }

  const sessionId = await getSessionId();
  await ensureLegacyWorkspacesBackfilled(sessionId);

  const workspace = await prisma.workspace.findUnique({
    where: {
      accessKeyHash: hashAccessKey(trimmedKey),
    },
  });

  if (!workspace) {
    return null;
  }

  await prisma.workspaceSession.upsert({
    where: {
      sessionId,
    },
    update: {
      workspaceId: workspace.id,
    },
    create: {
      sessionId,
      workspaceId: workspace.id,
    },
  });

  await clearPendingWorkspaceRecoveryKey();

  return {
    id: workspace.id,
    accessKeyPrefix: workspace.accessKeyPrefix,
  } satisfies CurrentWorkspace;
}
