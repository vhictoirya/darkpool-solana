/**
 * Ika dWallet integration — bridgeless cross-chain asset control.
 *
 * Program ID (Solana devnet): DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq
 * gRPC endpoint:              pre-alpha-dev-1.ika.ika-network.net:443
 *
 * Ika uses 2PC-MPC: the user holds one key share, Ika's MPC network holds the
 * other. Neither can sign alone. This gives non-custodial control over native
 * BTC/ETH without wrapping or bridge contracts.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { PublicKey, Connection, Transaction, SystemProgram } from "@solana/web3.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const IKA_PROGRAM_ID = new PublicKey(
  "DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq"
);

export const IKA_GRPC_ENDPOINT = "pre-alpha-dev-1.ika.ika-network.net:443";

export const DARKPOOL_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5"
);

export type ChainId = "solana" | "bitcoin" | "ethereum";

export const CHAIN_IDS: Record<ChainId, number> = {
  solana: 0,
  bitcoin: 1,
  ethereum: 2,
};

// ── gRPC client factory ───────────────────────────────────────────────────────

let _client: any = null;

function getIkaClient(): any {
  if (_client) return _client;

  const protoPath = path.join(__dirname, "../proto/ika.proto");
  const pkg = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkg) as any;

  _client = new proto.ika.DWalletService(
    IKA_GRPC_ENDPOINT,
    grpc.credentials.createSsl()
  );
  return _client;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DWallet {
  id: Uint8Array;              // 32-byte dWallet ID — stored in TraderVault on-chain
  publicKey: string;           // chain-native address (BTC addr, ETH addr, Solana pubkey)
  chain: ChainId;
  userShareEncrypted: Uint8Array; // user's encrypted MPC key share — store securely
  sessionId: string;
}

export interface TransferResult {
  txHash: string;
  status: "pending" | "confirmed" | "failed";
  sessionId: string;
}

// ── dWallet creation ─────────────────────────────────────────────────────────

/**
 * Create a new Ika dWallet for the given chain.
 *
 * Calls the Ika MPC network to run a distributed keygen ceremony.
 * The resulting dWallet ID is stored in the TraderVault on-chain account.
 * The user's encrypted share must be stored by the frontend (localStorage or
 * encrypted keystore) — it is needed to authorise future transfers.
 */
export async function createDWallet(
  chain: ChainId,
  ownerPubkey: PublicKey
): Promise<DWallet> {
  return new Promise((resolve, reject) => {
    const client = getIkaClient();
    client.CreateDWallet(
      {
        chain,
        owner_pubkey: ownerPubkey.toBytes(),
        solana_program: DARKPOOL_PROGRAM_ID.toBytes(),
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Ika CreateDWallet: ${err.message}`));
        resolve({
          id: new Uint8Array(res.dwallet_id),
          publicKey: res.dwallet_pubkey.toString("utf8"),
          chain,
          userShareEncrypted: new Uint8Array(res.user_share_encrypted),
          sessionId: res.session_id,
        });
      }
    );
  });
}

// ── Cross-chain transfer ──────────────────────────────────────────────────────

/**
 * Initiate a bridgeless transfer on the destination chain.
 *
 * The on-chain `withdraw` instruction emits a `WithdrawalRequested` event.
 * This function submits the user's MPC share alongside that event proof so
 * the Ika network can co-sign and broadcast the destination-chain transaction.
 *
 * @param dwalletId      - 32-byte dWallet ID from the TraderVault
 * @param userShareEnc   - user's encrypted MPC share (from DWallet creation)
 * @param destination    - destination address string (BTC addr, ETH addr, etc.)
 * @param amount         - amount in chain base units (sats for BTC, wei for ETH)
 * @param chain          - destination chain
 * @param withdrawProof  - serialised WithdrawalRequested event proof from Solana
 */
export async function initiateTransfer(
  dwalletId: Uint8Array,
  userShareEnc: Uint8Array,
  destination: string,
  amount: bigint,
  chain: ChainId,
  withdrawProof: Uint8Array
): Promise<TransferResult> {
  return new Promise((resolve, reject) => {
    const client = getIkaClient();
    client.InitiateTransfer(
      {
        dwallet_id: Buffer.from(dwalletId),
        destination_address: destination,
        amount: amount.toString(),
        chain,
        user_share_encrypted: Buffer.from(userShareEnc),
        withdraw_event_proof: Buffer.from(withdrawProof),
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Ika InitiateTransfer: ${err.message}`));
        resolve({
          txHash: res.tx_hash,
          status: res.status as TransferResult["status"],
          sessionId: res.session_id,
        });
      }
    );
  });
}

// ── Transfer status polling ───────────────────────────────────────────────────

export async function getTransferStatus(
  txHash: string
): Promise<{ status: "pending" | "confirmed" | "failed"; confirmations: number }> {
  return new Promise((resolve, reject) => {
    const client = getIkaClient();
    client.GetTransferStatus(
      { tx_hash: txHash },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Ika GetTransferStatus: ${err.message}`));
        resolve({
          status: res.status as "pending" | "confirmed" | "failed",
          confirmations: Number(res.confirmations),
        });
      }
    );
  });
}

// ── Serialise WithdrawalRequested event for Ika ───────────────────────────────

/**
 * Fetch and serialise the most recent WithdrawalRequested event for a given
 * withdraw request PDA. Passed to initiateTransfer as `withdrawProof`.
 *
 * Ika nodes independently verify this against Solana finality before signing.
 */
export async function fetchWithdrawProof(
  connection: Connection,
  withdrawRequestPubkey: PublicKey
): Promise<Uint8Array> {
  const accountInfo = await connection.getAccountInfo(withdrawRequestPubkey, "finalized");
  if (!accountInfo) throw new Error("WithdrawRequest account not found");
  // The raw account data is the proof — Ika nodes re-derive the PDA to verify ownership.
  return new Uint8Array(accountInfo.data);
}
