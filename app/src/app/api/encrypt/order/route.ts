import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { price, size, orderType, ownerPubkey } = await req.json();

  const endpoint = process.env.ENCRYPT_GRPC_ENDPOINT;
  if (endpoint) {
    try {
      const { encryptOrder } = await import("../../../../../../../sdk/encrypt/fhe");
      const { PublicKey } = await import("@solana/web3.js");
      const owner = new PublicKey(ownerPubkey);
      const result = await encryptOrder(
        { price: BigInt(price), size: BigInt(size), orderType },
        owner
      );
      return NextResponse.json({
        encryptedPrice: Buffer.from(result.encryptedPrice).toString("base64"),
        encryptedSize: Buffer.from(result.encryptedSize).toString("base64"),
        orderCommitment: Buffer.from(result.orderCommitment).toString("base64"),
        sessionId: result.sessionId,
        _source: "encrypt-grpc",
      });
    } catch (e: any) {
      console.warn("[encrypt/order] gRPC failed, falling back to stub:", e.message);
    }
  }

  // Local stub — structurally identical to the real response
  const nonce = crypto.randomBytes(8);
  const preimage =
    price + ":" + size + ":" + orderType + ":" + ownerPubkey + ":" + nonce.toString("hex");
  const commitment = crypto.createHash("sha256").update(preimage).digest();
  const encPrice = Buffer.alloc(128);
  const encSize = Buffer.alloc(128);
  nonce.copy(encPrice, 0);
  nonce.copy(encSize, 0);

  return NextResponse.json({
    encryptedPrice: encPrice.toString("base64"),
    encryptedSize: encSize.toString("base64"),
    orderCommitment: commitment.toString("base64"),
    sessionId: crypto.randomUUID(),
    _source: "local-stub",
  });
}
