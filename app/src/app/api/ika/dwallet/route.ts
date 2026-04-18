import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { chain, ownerPubkey } = await req.json();
  const id = crypto.createHash('sha256').update(chain + ':' + ownerPubkey).digest();
  return NextResponse.json({
    dwalletId: id.toString('base64'),
    publicKey: chain + '_' + ownerPubkey.slice(0, 8),
    userShareEncrypted: crypto.randomBytes(32).toString('base64'),
    sessionId: crypto.randomUUID(),
    _source: 'local-fallback'
  });
}