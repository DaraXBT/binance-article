import { z } from 'zod';

import { AppError } from '@/server/http/errors';

import { getRuntimeAuth } from './runtime';

const ActorSchema = z.object({
  id: z.string().min(1).max(200),
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  status: z.enum(['pending', 'active', 'suspended', 'revoked']),
  role: z.enum(['owner', 'user']),
}).passthrough();

const SessionResponseSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
  }).passthrough(),
  user: ActorSchema,
});

export type AuthenticatedActor = Pick<
  z.infer<typeof ActorSchema>,
  'id' | 'email' | 'name' | 'status' | 'role'
> & { sessionId: string };

export interface AuthorizeRequestOptions {
  getSession(input: { headers: Headers }): Promise<unknown>;
  requireOwner?: boolean;
}

export interface EnrollmentActor {
  sessionId: string;
  id: string;
  email: string;
  name: string;
  status: 'pending' | 'active';
  role: 'owner' | 'user';
}

function authRequired(): AppError {
  return new AppError({
    code: 'AUTH_REQUIRED',
    message: 'Authentication is required.',
    status: 401,
  });
}

export async function authorizeRequest(
  request: Request,
  { getSession, requireOwner = false }: AuthorizeRequestOptions,
): Promise<AuthenticatedActor> {
  const result = SessionResponseSchema.safeParse(await getSession({ headers: request.headers }));
  if (!result.success || result.data.session.userId !== result.data.user.id) throw authRequired();

  const { id, email, name, status, role } = result.data.user;
  if (status !== 'active') {
    throw new AppError({
      code: 'ACCOUNT_DISABLED',
      message: 'This account is disabled.',
      status: 403,
    });
  }
  if (requireOwner && role !== 'owner') {
    throw new AppError({
      code: 'OWNER_REQUIRED',
      message: 'Owner access is required.',
      status: 403,
    });
  }

  return { sessionId: result.data.session.id, id, email, name, status, role };
}

export async function authorizeEnrollmentRequest(
  request: Request,
  { getSession }: Pick<AuthorizeRequestOptions, 'getSession'>,
): Promise<EnrollmentActor> {
  const result = SessionResponseSchema.safeParse(await getSession({ headers: request.headers }));
  if (!result.success || result.data.session.userId !== result.data.user.id) throw authRequired();

  const { id, email, name, status, role } = result.data.user;
  if (status === 'suspended' || status === 'revoked') {
    throw new AppError({
      code: 'ACCOUNT_DISABLED',
      message: 'This account is disabled.',
      status: 403,
    });
  }

  return { sessionId: result.data.session.id, id, email, name, status, role };
}

export function requireEnrollmentUser(request: Request) {
  const auth = getRuntimeAuth();
  return authorizeEnrollmentRequest(request, {
    getSession: ({ headers }) => auth.api.getSession({ headers }),
  });
}

export function requireActiveUser(
  request: Request,
  options: { requireOwner?: boolean } = {},
) {
  const auth = getRuntimeAuth();
  return authorizeRequest(request, {
    getSession: ({ headers }) => auth.api.getSession({ headers }),
    requireOwner: options.requireOwner,
  });
}
