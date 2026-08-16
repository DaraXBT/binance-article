import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createEnrollmentAdminRepository } from '@/server/modules/admin/enrollment/repository';
import { listEnrollmentPeople } from '@/server/modules/admin/enrollment/service';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActiveUser(request, { requireOwner: true });
    const people = await listEnrollmentPeople({
      repository: createEnrollmentAdminRepository(getRuntimeDatabase()),
      actorUserId: actor.id,
    });
    return NextResponse.json({
      people: people.map((person) => ({
        ...person,
        createdAt: person.createdAt?.toISOString() ?? null,
        lastActiveAt: person.lastActiveAt?.toISOString() ?? null,
      })),
    }, { headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }) });
  } catch (error) {
    return errorResponse(error, {
      code: 'PEOPLE_LIST_FAILED',
      message: 'People could not be loaded.',
      status: 500,
    });
  }
}
