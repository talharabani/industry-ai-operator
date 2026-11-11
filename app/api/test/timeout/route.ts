import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const delayMs = parseInt(searchParams.get('delay') || '2000', 10);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return NextResponse.json({
    status: 'delayed_response',
    waited_ms: delayMs,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const delayMs = parseInt(searchParams.get('delay') || '2000', 10);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return NextResponse.json({
    status: 'delayed_response',
    waited_ms: delayMs,
    timestamp: new Date().toISOString(),
  });
}
