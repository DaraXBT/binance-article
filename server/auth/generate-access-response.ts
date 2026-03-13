import { NextResponse } from 'next/server';

import {
  clearGenerateAccess,
  type GenerateAccessGrantFailureReason,
  type GenerateAccessInvalidReason,
} from '@/lib/generate-access';
import { withNoStoreHeaders } from '@/server/http/errors';

function getGenerateAccessErrorMessage(
  reason: GenerateAccessInvalidReason | GenerateAccessGrantFailureReason | null | undefined
) {
  switch (reason) {
    case 'rotated':
      return 'Generation access code has changed. Please request the latest code from the admin.';
    case 'already_used':
      return 'This generation access code is already being used by another browser session.';
    case 'revoked':
      return 'This generation access code is no longer active.';
    case 'session_mismatch':
    case 'workspace_mismatch':
      return 'Generation access is locked for this browser session. Enter the latest code to continue.';
    default:
      return 'Generation access code required.';
  }
}

export function createGenerateAccessRequiredResponse({
  reason,
  clearCookie = false,
}: {
  reason?: GenerateAccessInvalidReason | GenerateAccessGrantFailureReason | null;
  clearCookie?: boolean;
} = {}) {
  const response = NextResponse.json(
    {
      error: getGenerateAccessErrorMessage(reason),
      code: 'GENERATE_ACCESS_REQUIRED',
      reason: reason ?? 'missing',
    },
    {
      status: 403,
      headers: withNoStoreHeaders(),
    }
  );

  if (clearCookie) {
    clearGenerateAccess(response);
  }

  return response;
}
