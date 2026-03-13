import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';

import prisma from '@/lib/prisma';
import {
  getCurrentGenerateAccessState,
  type GenerateAccessInvalidReason,
  isGenerateAccessEnabled,
} from '@/lib/generate-access';
import { getSessionId } from '@/lib/session';
import { AppError } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';

const WORKSPACE_RECOVERY_COOKIE_NAME = 'deckforge_workspace_key_reveal';
const WORKSPACE_RECOVERY_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

export interface CurrentWorkspace {
  id: string;
  accessKeyPrefix: string;
}

export interface WorkspaceBootstrap {
  hasWorkspace: boolean;
  workspaceId: string | null;
  accessKeyPrefix: string | null;
  recoveryKey: string | null;
  generateAccessEnabled: boolean;
  hasGenerationAccess: boolean;
  generationAccessInvalidReason: GenerateAccessInvalidReason | null;
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
    sameSite: 'strict',
    maxAge: WORKSPACE_RECOVERY_COOKIE_MAX_AGE,
    path: '/',
  });
}

async function clearPendingWorkspaceRecoveryKey() {
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_RECOVERY_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
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

export async function getCurrentWorkspace() {
  const sessionId = await getSessionId();

  const existingSession = await prisma.workspaceSession.findUnique({
    where: { sessionId },
    include: {
      workspace: true,
    },
  });

  if (!existingSession?.workspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found for current session.',
      status: 404,
    });
  }

  return {
    sessionId,
    workspace: {
      id: existingSession.workspace.id,
      accessKeyPrefix: existingSession.workspace.accessKeyPrefix,
    } satisfies CurrentWorkspace,
  };
}

export async function createWorkspaceForCurrentSession() {
  const sessionId = await getSessionId();

  const existingSession = await prisma.workspaceSession.findUnique({
    where: { sessionId },
    include: {
      workspace: true,
    },
  });

  if (existingSession?.workspace) {
    return {
      workspace: {
        id: existingSession.workspace.id,
        accessKeyPrefix: existingSession.workspace.accessKeyPrefix,
      } satisfies CurrentWorkspace,
      recoveryKey: await consumePendingWorkspaceRecoveryKey(),
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
      workspace: {
        id: workspace.id,
        accessKeyPrefix: workspace.accessKeyPrefix,
      } satisfies CurrentWorkspace,
      recoveryKey: generated.accessKey,
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
        workspace: {
          id: concurrentSession.workspace.id,
          accessKeyPrefix: concurrentSession.workspace.accessKeyPrefix,
        } satisfies CurrentWorkspace,
        recoveryKey: await consumePendingWorkspaceRecoveryKey(),
      };
    }

    throw error;
  }
}

export async function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  const sessionId = await getSessionId();

  const existingSession = await prisma.workspaceSession.findUnique({
    where: { sessionId },
    include: {
      workspace: true,
    },
  });

  if (!existingSession?.workspace) {
    return {
      hasWorkspace: false,
      workspaceId: null,
      accessKeyPrefix: null,
      recoveryKey: null,
      generateAccessEnabled: isGenerateAccessEnabled(),
      hasGenerationAccess: false,
      generationAccessInvalidReason: isGenerateAccessEnabled() ? 'missing' : null,
    };
  }

  const generationAccess = await getCurrentGenerateAccessState({
    workspaceId: existingSession.workspace.id,
    sessionId,
  });

  return {
    hasWorkspace: true,
    workspaceId: existingSession.workspace.id,
    accessKeyPrefix: existingSession.workspace.accessKeyPrefix,
    recoveryKey: await consumePendingWorkspaceRecoveryKey(),
    generateAccessEnabled: isGenerateAccessEnabled(),
    hasGenerationAccess: generationAccess.hasAccess,
    generationAccessInvalidReason: generationAccess.invalidReason,
  };
}

export async function recoverWorkspaceForCurrentSession(accessKey: string) {
  const trimmedKey = accessKey.trim();
  if (!trimmedKey) {
    return null;
  }

  const sessionId = await getSessionId();

  const workspace = await prisma.workspace.findUnique({
    where: {
      accessKeyHash: hashAccessKey(trimmedKey),
    },
  });

  if (!workspace) {
    logEvent('warn', 'workspace.recovery.not_found', { accessKeyPrefix: trimmedKey.slice(0, 12) });
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

  logEvent('info', 'workspace.recovery.success', { workspaceId: workspace.id });

  return {
    id: workspace.id,
    accessKeyPrefix: workspace.accessKeyPrefix,
  } satisfies CurrentWorkspace;
}
