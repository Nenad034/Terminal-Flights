import { NextRequest, NextResponse } from "next/server";

const BOOKING_URL = process.env.BOOKING_URL ?? "http://localhost:4002";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const upstream = await fetch(`${BOOKING_URL}/orders/${orderId}`);
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
