import { NextRequest, NextResponse } from 'next/server';
import { grantAppAccess, isValidAppAccessCode } from '@/lib/app-access';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const code = typeof body?.code === 'string' ? body.code : '';

  if (!isValidAppAccessCode(code)) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  await grantAppAccess(response);
  return response;
}
