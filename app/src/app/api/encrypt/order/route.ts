import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { price, size, orderType, ownerPubkey } = await req.json();
  const nonce = crypto.randomBytes(8);
  const preimage = price + ':' + size + ':' + orderType + ':' + ownerPubkey + ':' + nonce.toString('hex');
  const commitment = crypto.createHash('sha256').update(preimage).digest();
  const encPrice = Buffer.alloc(128);
  const encSize = Buffer.alloc(128);
  nonce.copy(encPrice, 0);
  nonce.copy(encSize, 0);
  return NextResponse.json({
    encryptedPrice: encPrice.toString('base64'),
    encryptedSize: encSize.toString('base64'),
    orderCommitment: commitment.toString('base64'),
    sessionId: crypto.randomUUID(),
    _source: 'local-fallback'
  });
}