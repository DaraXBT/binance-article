import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createEnrollmentAdminRepository } from '@/server/modules/admin/enrollment/repository';
import { getEnrollmentOverview } from '@/server/modules/admin/enrollment/service';

export async function GET(request: NextRequest) {
  try {
    await requireActiveUser(request, { requireOwner: true });
    const repository = createEnrollmentAdminRepository(getRuntimeDatabase());
    const overview = await getEnrollmentOverview({ repository });
    return NextResponse.json({
      activeCode: overview.code ? {
        version: overview.code.version,
        codePrefix: overview.code.codePrefix,
        status: overview.code.status,
        createdAt: overview.code.createdAt?.toISOString() ?? null,
      } : null,
      capacity: overview.capacity,
    }, { headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }) });
  } catch (error) {
    return errorResponse(error, {
      code: 'ENROLLMENT_OVERVIEW_FAILED',
      message: 'Enrollment access could not be loaded.',
      status: 400,
    });
  }
}
