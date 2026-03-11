import { NextRequest, NextResponse } from 'next/server';
import { grantAppAccess, isValidAppAccessCode } from '@/lib/app-access';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    const body = await request.json();
    const code = typeof body?.code === 'string' ? body.code : '';

    if (!(await isValidAppAccessCode(code))) {
      return NextResponse.json(
        { error: 'Invalid access code', code: 'INVALID_ACCESS_CODE' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    const response = NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
    await grantAppAccess(response);
    return response;
  } catch (error) {
    return errorResponse(error, {
      code: 'ACCESS_GATE_FAILED',
      message: 'The access request could not be completed.',
      status: 400,
    });
  }
}
