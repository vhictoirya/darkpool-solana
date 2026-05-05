import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { dwalletId, userShareEncrypted, destination, amount, chain, withdrawProof } =
    await req.json();

  const endpoint = process.env.IKA_GRPC_ENDPOINT;
  if (endpoint) {
    try {
      const { initiateTransfer } = await import("../../../../../../sdk/ika/dwallet");
      const result = await initiateTransfer(
        new Uint8Array(Buffer.from(dwalletId, "base64")),
        new Uint8Array(Buffer.from(userShareEncrypted, "base64")),
        destination,
        BigInt(amount),
        chain,
        new Uint8Array(Buffer.from(withdrawProof, "base64"))
      );
      return NextResponse.json({ ...result, _source: "ika-grpc" });
    } catch (e: any) {
      console.warn("[ika/transfer] gRPC failed, falling back to stub:", e.message);
    }
  }

  return NextResponse.json({
    txHash: "stub_" + crypto.randomBytes(16).toString("hex"),
    status: "pending",
    sessionId: crypto.randomUUID(),
    _source: "local-stub",
  });
}

export async function GET(req: NextRequest) {
  const txHash = req.nextUrl.searchParams.get("txHash");

  const endpoint = process.env.IKA_GRPC_ENDPOINT;
  if (endpoint && txHash && !txHash.startsWith("stub_")) {
    try {
      const { getTransferStatus } = await import("../../../../../../sdk/ika/dwallet");
      const result = await getTransferStatus(txHash);
      return NextResponse.json({ ...result, _source: "ika-grpc" });
    } catch (e: any) {
      console.warn("[ika/transfer] status gRPC failed:", e.message);
    }
  }

  return NextResponse.json({
    status: "pending",
    confirmations: 0,
    _source: "local-stub",
  });
}
