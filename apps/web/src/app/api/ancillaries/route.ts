import { NextRequest, NextResponse } from "next/server";

// BFF proxy (§02) direktno ka supplier-layer (§03/§07) — ancillaries žive
// ispod ponude, ne ispod već kreiranog order-a, pa ne prolaze kroz booking.
const SUPPLIER_LAYER_URL = process.env.SUPPLIER_LAYER_URL ?? "http://localhost:4001";

export async function POST(req: NextRequest) {
  const { supplierCode, supplierOfferRef } = await req.json();

  const upstream = await fetch(
    `${SUPPLIER_LAYER_URL}/offers/${supplierOfferRef}/ancillaries?supplierCode=${supplierCode}`
  );

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
