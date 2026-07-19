export const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

const INVITATION_ENTROPY_BYTES = 32;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface InvitationSecret {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}

export interface InvitationForEvaluation {
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
}

export type InvitationEvaluation =
  | { ok: true }
  | { ok: false; reason: 'invalid_token' | 'expired' | 'used' | 'revoked' };

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    const value = (first << 16) | (second << 8) | third;

    result += alphabet[(value >>> 18) & 63];
    result += alphabet[(value >>> 12) & 63];
    if (remaining > 1) result += alphabet[(value >>> 6) & 63];
    if (remaining > 2) result += alphabet[value & 63];
  }

  return result;
}

function encodeHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function hashInvitationToken(token: string): Promise<string> {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('Invitation token must be a non-empty string.');
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return encodeHex(new Uint8Array(digest));
}

export async function createInvitationSecret(entropy?: Uint8Array): Promise<InvitationSecret> {
  let bytes: Uint8Array;

  if (entropy === undefined) {
    bytes = new Uint8Array(INVITATION_ENTROPY_BYTES);
    crypto.getRandomValues(bytes);
  } else {
    if (!(entropy instanceof Uint8Array) || entropy.byteLength !== INVITATION_ENTROPY_BYTES) {
      throw new TypeError(`Invitation entropy must contain exactly ${INVITATION_ENTROPY_BYTES} bytes.`);
    }
    bytes = new Uint8Array(entropy);
  }

  const token = encodeBase64Url(bytes);
  return {
    token,
    tokenHash: await hashInvitationToken(token),
    tokenPrefix: token.slice(0, 8),
  };
}

export async function evaluateInvitation(
  invitation: InvitationForEvaluation,
  presentedToken: string,
  now = new Date(),
): Promise<InvitationEvaluation> {
  if (invitation.status === 'accepted') return { ok: false, reason: 'used' };
  if (invitation.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (invitation.status !== 'pending') return { ok: false, reason: 'invalid_token' };

  if (!(invitation.expiresAt instanceof Date) || !Number.isFinite(invitation.expiresAt.getTime())) {
    return { ok: false, reason: 'expired' };
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || invitation.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (!SHA256_HEX_PATTERN.test(invitation.tokenHash) || typeof presentedToken !== 'string' || presentedToken.length === 0) {
    return { ok: false, reason: 'invalid_token' };
  }

  const presentedHash = await hashInvitationToken(presentedToken);
  return constantTimeEqual(invitation.tokenHash, presentedHash)
    ? { ok: true }
    : { ok: false, reason: 'invalid_token' };
}
