import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { currentEncrypted, depositAmount, ownerPubkey } = await req.json();

  const endpoint = process.env.ENCRYPT_GRPC_ENDPOINT;
  if (endpoint) {
    try {
      const { encryptBalance } = await import("../../../../../../../sdk/encrypt/fhe");
      const { PublicKey } = await import("@solana/web3.js");
      const owner = new PublicKey(ownerPubkey);
      const current = currentEncrypted
        ? new Uint8Array(Buffer.from(currentEncrypted, "base64"))
        : null;
      const result = await encryptBalance(current, BigInt(depositAmount), owner);
      return NextResponse.json({
        encryptedBalance: Buffer.from(result).toString("base64"),
        _source: "encrypt-grpc",
      });
    } catch (e: any) {
      console.warn("[encrypt/balance] gRPC failed, falling back to stub:", e.message);
    }
  }

  // Local stub — encodes the deposit amount at offset 0 in a 128-byte buffer
  const buf = Buffer.alloc(128);
  try {
    buf.writeBigUInt64LE(BigInt(depositAmount), 0);
  } catch {}

  return NextResponse.json({
    encryptedBalance: buf.toString("base64"),
    _source: "local-stub",
  });
}
