import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { dwalletId, destination, amount, chain } = await req.json();
  return NextResponse.json({
    txHash: "stub_" + crypto.randomBytes(16).toString("hex"),
    status: "pending",
    sessionId: crypto.randomUUID(),
    _source: "local-stub",
  });
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: "pending",
    confirmations: 0,
    _source: "local-stub",
  });
}
