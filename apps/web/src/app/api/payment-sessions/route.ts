import { NextRequest, NextResponse } from "next/server";

// BFF proxy (§02) ka supplier-layer (§07) — generiše Duffel "component
// client key" pre nego što se prikaže DuffelCardForm na klijentu.
const SUPPLIER_LAYER_URL = process.env.SUPPLIER_LAYER_URL ?? "http://localhost:4001";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const upstream = await fetch(`${SUPPLIER_LAYER_URL}/payment-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
