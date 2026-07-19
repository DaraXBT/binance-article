import { APIError } from 'better-auth/api';
import { z } from 'zod';

import { hashInvitationToken } from '@/server/domain/invitations';

export const INVITATION_ENROLLMENT_COOKIE = 'xarticle_invitation';
const INVITATION_ENROLLMENT_MAX_AGE_SECONDS = 15 * 60;

const EnrollmentCandidateSchema = z.object({
  email: z.string().trim().email().max(320),
}).passthrough();

const EnrollmentUserSchema = EnrollmentCandidateSchema.extend({
  id: z.string().trim().min(1).max(200),
});

export interface InvitationEnrollmentRepository {
  reserve(input: {
    tokenHash: string;
    email: string;
    now: Date;
  }): Promise<{ id: string } | null>;
  attachUser(input: {
    invitationId: string;
    userId: string;
    now: Date;
  }): Promise<void>;
}

export interface InvitationEnrollmentGateOptions {
  repository: InvitationEnrollmentRepository;
  now?: () => Date;
}

function enrollmentError(message = 'A valid invitation is required to create an account.') {
  return new APIError('FORBIDDEN', { message });
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
  const reservations = new Map<string, string>();

  return {
    async beforeUserCreate(userInput: unknown, context: unknown) {
      const user = EnrollmentCandidateSchema.parse(userInput);
      const request = assertGoogleEnrollmentRequest(context);
      const token = readCookie(request, INVITATION_ENROLLMENT_COOKIE);
      if (!token) throw enrollmentError();
      const email = user.email.toLowerCase();

      const reservation = await repository.reserve({
        tokenHash: await hashInvitationToken(token),
        email,
        now: now(),
      });
      if (!reservation) throw enrollmentError('The invitation is invalid or expired.');
      reservations.set(email, reservation.id);
    },

    async afterUserCreate(userInput: unknown, context: unknown) {
      const user = EnrollmentUserSchema.parse(userInput);
      assertGoogleEnrollmentRequest(context);
      const email = user.email.toLowerCase();
      const invitationId = reservations.get(email);
      if (!invitationId) throw enrollmentError('The invitation reservation is missing.');

      try {
        await repository.attachUser({ invitationId, userId: user.id, now: now() });
      } finally {
        reservations.delete(email);
      }
    },
  };
}

export function serializeInvitationEnrollmentCookie(
  token: string,
  options: { secure: boolean },
): string {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) {
    throw new TypeError('Invitation token is invalid.');
  }

  const attributes = [
    `${INVITATION_ENROLLMENT_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${INVITATION_ENROLLMENT_MAX_AGE_SECONDS}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}
