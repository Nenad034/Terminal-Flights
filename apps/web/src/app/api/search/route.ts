import { NextRequest, NextResponse } from "next/server";

// BFF proxy (§02 Referentna arhitektura) ka search-fanout servisu (§04).
const SEARCH_FANOUT_URL =
  process.env.SEARCH_FANOUT_URL ?? "http://localhost:4003";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const upstream = await fetch(`${SEARCH_FANOUT_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
