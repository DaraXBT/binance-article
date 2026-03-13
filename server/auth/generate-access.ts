import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

import prisma from '@/lib/prisma';

export const GENERATE_ACCESS_COOKIE_NAME = 'deckforge_generate_access';

export type GenerateAccessInvalidReason =
  | 'missing'
  | 'invalid'
  | 'rotated'
  | 'workspace_mismatch'
  | 'session_mismatch'
  | 'revoked';

export type GenerateAccessGrantFailureReason =
  | 'invalid_code'
  | 'rotated'
  | 'already_used'
  | 'revoked';

export type GenerateAccessState = {
  enabled: boolean;
  hasAccess: boolean;
  invalidReason: GenerateAccessInvalidReason | null;
  grantId: string | null;
};

export type ConsumeGenerateAccessGrantResult =
  | { ok: true; grantId: string }
  | { ok: false; reason: GenerateAccessGrantFailureReason };

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function buildState(
  enabled: boolean,
  hasAccess: boolean,
  invalidReason: GenerateAccessInvalidReason | null,
  grantId: string | null
): GenerateAccessState {
  return {
    enabled,
    hasAccess,
    invalidReason,
    grantId,
  };
}

async function resolveGenerateAccessState({
  grantId,
  workspaceId,
  sessionId,
}: {
  grantId: string | null;
  workspaceId: string | null;
  sessionId: string;
}): Promise<GenerateAccessState> {
  if (!isGenerateAccessEnabled()) {
    return buildState(false, true, null, null);
  }

  if (!grantId || !workspaceId) {
    return buildState(true, false, 'missing', null);
  }

  const grant = await prisma.generationAccessGrant.findUnique({
    where: { id: grantId },
  });

  if (!grant) {
    return buildState(true, false, 'invalid', null);
  }

  if (grant.envCodeHash !== getConfiguredGenerateAccessCodeHash()) {
    return buildState(true, false, 'rotated', grant.id);
  }

  if (grant.status === 'revoked') {
    return buildState(true, false, 'revoked', grant.id);
  }

  if (!grant.boundWorkspaceId || grant.boundWorkspaceId !== workspaceId) {
    return buildState(true, false, 'workspace_mismatch', grant.id);
  }

  if (!grant.boundSessionId || grant.boundSessionId !== sessionId) {
    return buildState(true, false, 'session_mismatch', grant.id);
  }

  return buildState(true, true, null, grant.id);
}

export function hashGenerateAccessCode(value: string) {
  return hashValue(value.trim());
}

export function getConfiguredGenerateAccessCode() {
  return process.env.GENERATE_ACCESS_CODE?.trim() ?? '';
}

export function getConfiguredGenerateAccessCodeHash() {
  const configured = getConfiguredGenerateAccessCode();
  return configured ? hashValue(configured) : '';
}

export function isGenerateAccessEnabled() {
  return getConfiguredGenerateAccessCode().length > 0;
}

export async function isValidGenerateAccessCode(input: string) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return false;
  }

  return hashGenerateAccessCode(input) === hashValue(configured);
}

export function createGenerateAccessCode() {
  return `gac_${randomBytes(18).toString('hex')}`;
}

export function getGenerateAccessCodePrefix(code: string) {
  return code.trim().slice(0, 12);
}

export function grantGenerateAccess(response: NextResponse, grantId: string) {
  response.cookies.set(GENERATE_ACCESS_COOKIE_NAME, grantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

export function clearGenerateAccess(response: NextResponse) {
  response.cookies.set(GENERATE_ACCESS_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
}

export async function getCurrentGenerateAccessState({
  workspaceId,
  sessionId,
}: {
  workspaceId: string | null;
  sessionId: string;
}) {
  const cookieStore = await cookies();

  return resolveGenerateAccessState({
    grantId: cookieStore.get(GENERATE_ACCESS_COOKIE_NAME)?.value ?? null,
    workspaceId,
    sessionId,
  });
}

export async function hasGrantedGenerateAccess(
  request: NextRequest,
  {
    workspaceId,
    sessionId,
  }: {
    workspaceId: string | null;
    sessionId: string;
  }
) {
  const state = await resolveGenerateAccessState({
    grantId: request.cookies.get(GENERATE_ACCESS_COOKIE_NAME)?.value ?? null,
    workspaceId,
    sessionId,
  });

  return state.hasAccess;
}

export async function getRequestGenerateAccessState(
  request: NextRequest,
  {
    workspaceId,
    sessionId,
  }: {
    workspaceId: string | null;
    sessionId: string;
  }
) {
  return resolveGenerateAccessState({
    grantId: request.cookies.get(GENERATE_ACCESS_COOKIE_NAME)?.value ?? null,
    workspaceId,
    sessionId,
  });
}

export async function consumeGenerateAccessGrant({
  code,
  workspaceId,
  sessionId,
}: {
  code: string;
  workspaceId: string;
  sessionId: string;
}): Promise<ConsumeGenerateAccessGrantResult> {
  if (!isGenerateAccessEnabled()) {
    return { ok: false, reason: 'invalid_code' };
  }

  const trimmedCode = code.trim();
  if (!trimmedCode) {
    return { ok: false, reason: 'invalid_code' };
  }

  const grant = await prisma.generationAccessGrant.findUnique({
    where: {
      codeHash: hashGenerateAccessCode(trimmedCode),
    },
  });

  if (!grant) {
    return { ok: false, reason: 'invalid_code' };
  }

  const currentEnvCodeHash = getConfiguredGenerateAccessCodeHash();

  if (!currentEnvCodeHash || grant.envCodeHash !== currentEnvCodeHash) {
    return { ok: false, reason: 'rotated' };
  }

  if (grant.status === 'revoked') {
    return { ok: false, reason: 'revoked' };
  }

  if (grant.boundWorkspaceId || grant.boundSessionId) {
    if (
      grant.boundWorkspaceId === workspaceId &&
      grant.boundSessionId === sessionId
    ) {
      return { ok: true, grantId: grant.id };
    }

    return { ok: false, reason: 'already_used' };
  }

  const consumedAt = new Date();
  const updated = await prisma.generationAccessGrant.updateMany({
    where: {
      id: grant.id,
      status: 'active',
      boundWorkspaceId: null,
      boundSessionId: null,
      envCodeHash: currentEnvCodeHash,
    },
    data: {
      status: 'consumed',
      boundWorkspaceId: workspaceId,
      boundSessionId: sessionId,
      consumedAt,
    },
  });

  if (updated.count === 1) {
    return { ok: true, grantId: grant.id };
  }

  const reboundGrant = await prisma.generationAccessGrant.findUnique({
    where: {
      id: grant.id,
    },
  });

  if (
    reboundGrant &&
    reboundGrant.envCodeHash === currentEnvCodeHash &&
    reboundGrant.status !== 'revoked' &&
    reboundGrant.boundWorkspaceId === workspaceId &&
    reboundGrant.boundSessionId === sessionId
  ) {
    return { ok: true, grantId: reboundGrant.id };
  }

  return { ok: false, reason: 'already_used' };
}
