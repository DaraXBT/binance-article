import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}
