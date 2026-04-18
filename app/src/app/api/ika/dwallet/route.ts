import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { chain, ownerPubkey } = await req.json();

  const endpoint = process.env.IKA_GRPC_ENDPOINT;
  if (endpoint) {
    try {
      const { createDWallet } = await import("../../../../../../sdk/ika/dwallet");
      const { PublicKey } = await import("@solana/web3.js");
      const owner = new PublicKey(ownerPubkey);
      const dwallet = await createDWallet(chain, owner);
      return NextResponse.json({
        dwalletId: Buffer.from(dwallet.id).toString("base64"),
        publicKey: dwallet.publicKey,
        userShareEncrypted: Buffer.from(dwallet.userShareEncrypted).toString("base64"),
        sessionId: dwallet.sessionId,
        _source: "ika-grpc",
      });
    } catch (e: any) {
      console.warn("[ika/dwallet] gRPC failed, falling back to stub:", e.message);
    }
  }

  // Local stub — deterministic for the same chain + owner so UI is consistent
  const id = crypto.createHash("sha256").update(chain + ":" + ownerPubkey).digest();
  return NextResponse.json({
    dwalletId: id.toString("base64"),
    publicKey: chain + "_" + ownerPubkey.slice(0, 8),
    userShareEncrypted: crypto.randomBytes(32).toString("base64"),
    sessionId: crypto.randomUUID(),
    _source: "local-stub",
  });
}
