import { NextRequest, NextResponse } from "next/server";

// BFF proxy (§02 Referentna arhitektura) ka booking servisu (§05).
const BOOKING_URL = process.env.BOOKING_URL ?? "http://localhost:4002";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const upstream = await fetch(`${BOOKING_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
