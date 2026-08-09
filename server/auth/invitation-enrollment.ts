import { APIError } from 'better-auth/api';
import { z } from 'zod';

import { isAppError } from '@/server/http/errors';
import { assertEnrollmentClaimToken } from '@/server/modules/enrollment/domain';
import {
  type EnrollmentReservationRepository,
  reserveEnrollmentClaim,
} from '@/server/modules/enrollment/service';

export const INVITATION_ENROLLMENT_COOKIE = 'xarticle_invitation';
export const ENROLLMENT_CLAIM_COOKIE = 'xarticle_enrollment_claim';
const INVITATION_ENROLLMENT_MAX_AGE_SECONDS = 15 * 60;
export const ENROLLMENT_CLAIM_MAX_AGE_SECONDS = 15 * 60;

const EnrollmentTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);

const EnrollmentCandidateSchema = z.object({
  email: z.string().trim().email().max(320),
  emailVerified: z.literal(true),
}).passthrough();

const EnrollmentUserSchema = EnrollmentCandidateSchema.extend({
  id: z.string().trim().min(1).max(200),
});

export type InvitationEnrollmentRepository = EnrollmentReservationRepository;

export interface InvitationEnrollmentGateOptions {
  repository: InvitationEnrollmentRepository;
  now?: () => Date;
}

function enrollmentError(message = 'A valid invitation is required to create an account.') {
  return new APIError('FORBIDDEN', { message });
}

function parseEnrollmentCandidate(userInput: unknown) {
  const parsed = EnrollmentCandidateSchema.safeParse(userInput);
  if (!parsed.success) {
    const emailVerified = userInput && typeof userInput === 'object'
      ? (userInput as Record<string, unknown>).emailVerified
      : undefined;
    if (emailVerified !== true) {
      throw enrollmentError('A verified Google identity is required to enroll.');
    }
    throw enrollmentError();
  }
  return parsed.data;
}

function getRequest(context: unknown): Request | null {
  if (!context || typeof context !== 'object' || !('request' in context)) return null;
  return context.request instanceof Request ? context.request : null;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function readEnrollmentClaimCookie(request: Request): string | null {
  return readCookie(request, ENROLLMENT_CLAIM_COOKIE);
}

function assertGoogleEnrollmentRequest(context: unknown): Request {
  const request = getRequest(context);
  if (!request) throw enrollmentError();

  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    throw enrollmentError();
  }
  if (!pathname.endsWith('/callback/google')) {
    throw enrollmentError('New accounts must enroll with an invited Google identity.');
  }
  return request;
}

export function createInvitationEnrollmentGate({
  repository,
  now = () => new Date(),
}: InvitationEnrollmentGateOptions) {
  return {
    async beforeUserCreate(userInput: unknown, context: unknown) {
      const user = parseEnrollmentCandidate(userInput);
      const request = assertGoogleEnrollmentRequest(context);
      const token = readCookie(request, ENROLLMENT_CLAIM_COOKIE);
      if (!token) throw enrollmentError();
      const email = user.email.toLowerCase();

      let reservation: Awaited<ReturnType<typeof reserveEnrollmentClaim>>;
      try {
        reservation = await reserveEnrollmentClaim({
          repository,
          claimToken: token,
          email,
          now: now(),
        });
      } catch (error) {
        if (isAppError(error)) {
          if (error.code === 'BETA_USER_CAP_REACHED') throw enrollmentError(error.message);
          if (error.code === 'ACCOUNT_DISABLED') throw enrollmentError('This account is not allowed to enroll.');
          if (error.code === 'ENROLLMENT_IDENTITY_MISMATCH') {
            throw enrollmentError('Continue with the Google identity used to start enrollment.');
          }
          if (error.code === 'INVALID_ENROLLMENT_CLAIM') {
            throw enrollmentError('The invitation is invalid or expired.');
          }
        }
        throw error;
      }
      if (!reservation.reserved) {
        throw enrollmentError('This Google identity is already enrolled.');
      }
    },

    async afterUserCreate(userInput: unknown, context: unknown) {
      EnrollmentUserSchema.parse(parseEnrollmentCandidate(userInput));
      const request = assertGoogleEnrollmentRequest(context);
      if (!readCookie(request, ENROLLMENT_CLAIM_COOKIE)) {
        throw enrollmentError('The invitation reservation is missing.');
      }
      // Activation, workspace creation, and linking this user id to the claim
      // intentionally happen in the retryable completion endpoint. Better
      // Auth's user/account insert may still roll back after this hook.
    },
  };
}

function serializeEnrollmentCookie(input: {
  name: string;
  token: string;
  maxAge: number;
  path: string;
  secure: boolean;
}): string {
  if (input.token && !EnrollmentTokenSchema.safeParse(input.token).success) {
    throw new TypeError('Enrollment token is invalid.');
  }

  const attributes = [
    `${input.name}=${encodeURIComponent(input.token)}`,
    `Max-Age=${input.maxAge}`,
    `Path=${input.path}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (input.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function serializeEnrollmentClaimCookie(
  token: string,
  options: { secure: boolean },
): string {
  assertEnrollmentClaimToken(token);
  return serializeEnrollmentCookie({
    name: ENROLLMENT_CLAIM_COOKIE,
    token,
    maxAge: ENROLLMENT_CLAIM_MAX_AGE_SECONDS,
    path: '/api',
    secure: options.secure,
  });
}

export function serializeExpiredEnrollmentClaimCookie(
  options: { secure: boolean },
): string {
  return serializeEnrollmentCookie({
    name: ENROLLMENT_CLAIM_COOKIE,
    token: '',
    maxAge: 0,
    path: '/api',
    secure: options.secure,
  });
}

export function serializeInvitationEnrollmentCookie(
  token: string,
  options: { secure: boolean },
): string {
  return serializeEnrollmentCookie({
    name: INVITATION_ENROLLMENT_COOKIE,
    token,
    maxAge: INVITATION_ENROLLMENT_MAX_AGE_SECONDS,
    path: '/api/auth',
    secure: options.secure,
  });
}
