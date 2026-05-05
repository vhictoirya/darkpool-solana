import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { depositAmount } = await req.json();
  const buf = Buffer.alloc(128);
  try { buf.writeBigUInt64LE(BigInt(depositAmount), 0); } catch {}
  return NextResponse.json({
    encryptedBalance: buf.toString("base64"),
    _source: "local-stub",
  });
}
