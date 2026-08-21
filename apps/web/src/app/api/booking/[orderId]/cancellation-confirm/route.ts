import { NextRequest, NextResponse } from "next/server";

const BOOKING_URL = process.env.BOOKING_URL ?? "http://localhost:4002";

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const body = await req.json();

  const upstream = await fetch(`${BOOKING_URL}/orders/${orderId}/cancellation-confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
