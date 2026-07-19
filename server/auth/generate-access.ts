import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

import { getRuntimeDatabase } from '@/server/db/runtime';

import { createGenerationAccessGrantRepository } from './generate-access-repository';

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

async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function equalStringsConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
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

  const repository = createGenerationAccessGrantRepository(getRuntimeDatabase());
  const grant = await repository.findById(grantId);

  if (!grant) {
    return buildState(true, false, 'invalid', null);
  }

  if (grant.envCodeHash !== await getConfiguredGenerateAccessCodeHash()) {
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

export async function hashGenerateAccessCode(value: string) {
  return hashValue(value.trim());
}

export function getConfiguredGenerateAccessCode() {
  return process.env.GENERATE_ACCESS_CODE?.trim() ?? '';
}

export async function getConfiguredGenerateAccessCodeHash() {
  const configured = getConfiguredGenerateAccessCode();
  return configured ? await hashValue(configured) : '';
}

export function isGenerateAccessEnabled() {
  return getConfiguredGenerateAccessCode().length > 0;
}

export async function isValidGenerateAccessCode(input: string) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return false;
  }

  const [inputHash, configuredHash] = await Promise.all([
    hashGenerateAccessCode(input),
    hashValue(configured),
  ]);
  return equalStringsConstantTime(inputHash, configuredHash);
}

export function createGenerateAccessCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `gac_${value}`;
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

  const repository = createGenerationAccessGrantRepository(getRuntimeDatabase());
  const grant = await repository.findByCodeHash(
    await hashGenerateAccessCode(trimmedCode),
  );

  if (!grant) {
    return { ok: false, reason: 'invalid_code' };
  }

  const currentEnvCodeHash = await getConfiguredGenerateAccessCodeHash();

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

  const consumed = await repository.consumeUnbound({
    grantId: grant.id,
    workspaceId,
    sessionId,
    envCodeHash: currentEnvCodeHash,
    now: new Date(),
  });

  if (consumed) {
    return { ok: true, grantId: grant.id };
  }

  const reboundGrant = await repository.findById(grant.id);

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
