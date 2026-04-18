/**
 * Encrypt FHE integration — confidential order state on Solana.
 *
 * Program ID (Solana devnet): 4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8
 * gRPC endpoint:              pre-alpha-dev-1.encrypt.ika-network.net:443
 *
 * Encrypt uses Fully Homomorphic Encryption so price, size, and direction are
 * never revealed on-chain. The MPC matching network computes over ciphertexts
 * without decrypting them. Only the settled price and size become public at
 * the moment of on-chain settlement.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { PublicKey } from "@solana/web3.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const ENCRYPT_PROGRAM_ID = new PublicKey(
  "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8"
);

export const ENCRYPT_GRPC_ENDPOINT = "pre-alpha-dev-1.encrypt.ika-network.net:443";

export const CIPHERTEXT_LEN = 128;
export const MATCH_PROOF_LEN = 256;

// ── gRPC client factory ───────────────────────────────────────────────────────

let _client: any = null;

function getEncryptClient(): any {
  if (_client) return _client;

  const protoPath = path.join(__dirname, "../proto/encrypt.proto");
  const pkg = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkg) as any;

  _client = new proto.encrypt.EncryptService(
    ENCRYPT_GRPC_ENDPOINT,
    grpc.credentials.createSsl()
  );
  return _client;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlainOrder {
  price: bigint;
  size: bigint;
  orderType: "bid" | "ask";
}

export interface EncryptedOrder {
  encryptedPrice: Uint8Array;   // 128-byte FHE ciphertext
  encryptedSize: Uint8Array;    // 128-byte FHE ciphertext
  orderCommitment: Uint8Array;  // 32-byte Pedersen commitment
  sessionId: string;
}

export interface MatchProofResult {
  matchProof: Uint8Array;   // 256-byte proof
  settledPrice: bigint;
  settledSize: bigint;
  status: "pending" | "ready" | "failed";
}

// ── Order encryption ──────────────────────────────────────────────────────────

/**
 * Encrypt an order's price and size using Encrypt FHE.
 *
 * Calls the Encrypt gRPC service which performs client-assisted FHE encryption.
 * The returned ciphertexts are stored on-chain in the Order account — no node
 * in the network (including Encrypt MPC nodes) can read the plaintext values.
 */
export async function encryptOrder(
  order: PlainOrder,
  owner: PublicKey
): Promise<EncryptedOrder> {
  return new Promise((resolve, reject) => {
    const client = getEncryptClient();
    client.EncryptOrder(
      {
        price: order.price.toString(),
        size: order.size.toString(),
        order_type: order.orderType === "bid" ? 0 : 1,
        owner: owner.toBytes(),
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Encrypt EncryptOrder: ${err.message}`));

        const encryptedPrice = new Uint8Array(res.encrypted_price);
        const encryptedSize = new Uint8Array(res.encrypted_size);
        const orderCommitment = new Uint8Array(res.order_commitment);

        if (encryptedPrice.length !== CIPHERTEXT_LEN)
          return reject(new Error(`Invalid ciphertext length: ${encryptedPrice.length}`));
        if (orderCommitment.length !== 32)
          return reject(new Error(`Invalid commitment length: ${orderCommitment.length}`));

        resolve({
          encryptedPrice,
          encryptedSize,
          orderCommitment,
          sessionId: res.session_id,
        });
      }
    );
  });
}

// ── Balance encryption ────────────────────────────────────────────────────────

/**
 * Homomorphically add a deposit to an FHE-encrypted balance.
 *
 * For a first deposit, pass null for currentEncrypted.
 * The Encrypt network performs Enc(old) + Enc(deposit) = Enc(old + deposit)
 * without revealing either value.
 */
export async function encryptBalance(
  currentEncrypted: Uint8Array | null,
  depositAmount: bigint,
  owner: PublicKey
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const client = getEncryptClient();
    client.EncryptBalance(
      {
        current_encrypted: currentEncrypted
          ? Buffer.from(currentEncrypted)
          : Buffer.alloc(0),
        deposit_amount: depositAmount.toString(),
        owner: owner.toBytes(),
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Encrypt EncryptBalance: ${err.message}`));
        resolve(new Uint8Array(res.encrypted_balance));
      }
    );
  });
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Submit a maker/taker order pair to the Encrypt MPC matching engine.
 * Returns a session ID to poll for the match proof.
 *
 * The matching engine runs FHE comparison operations to confirm price/size
 * compatibility without decrypting either order.
 */
export async function submitForMatching(
  makerOrderPubkey: PublicKey,
  takerOrderPubkey: PublicKey,
  makerCommitment: Uint8Array,
  takerCommitment: Uint8Array
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = getEncryptClient();
    client.SubmitForMatching(
      {
        maker_order_pubkey: makerOrderPubkey.toBytes(),
        taker_order_pubkey: takerOrderPubkey.toBytes(),
        maker_commitment: Buffer.from(makerCommitment),
        taker_commitment: Buffer.from(takerCommitment),
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Encrypt SubmitForMatching: ${err.message}`));
        resolve(res.match_session_id);
      }
    );
  });
}

/**
 * Poll the Encrypt network for a completed match proof.
 * Call repeatedly until status === "ready" or "failed".
 */
export async function getMatchProof(sessionId: string): Promise<MatchProofResult> {
  return new Promise((resolve, reject) => {
    const client = getEncryptClient();
    client.GetMatchProof(
      { match_session_id: sessionId },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Encrypt GetMatchProof: ${err.message}`));
        resolve({
          matchProof: new Uint8Array(res.match_proof),
          settledPrice: BigInt(res.settled_price),
          settledSize: BigInt(res.settled_size),
          status: res.status as MatchProofResult["status"],
        });
      }
    );
  });
}

/**
 * Poll for ready match proofs for all of a trader's orders.
 * Run by the relayer service to sweep completed matches on-chain.
 */
export async function getPendingMatches(owner: PublicKey): Promise<
  Array<{ sessionId: string; makerOrder: string; takerOrder: string; status: string }>
> {
  return new Promise((resolve, reject) => {
    const client = getEncryptClient();
    client.GetPendingMatches(
      { owner: owner.toBytes() },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(new Error(`Encrypt GetPendingMatches: ${err.message}`));
        resolve(
          res.matches.map((m: any) => ({
            sessionId: m.match_session_id,
            makerOrder: Buffer.from(m.maker_order_pubkey).toString("hex"),
            takerOrder: Buffer.from(m.taker_order_pubkey).toString("hex"),
            status: m.status,
          }))
        );
      }
    );
  });
}

// ── Client-side proof verification ───────────────────────────────────────────

/**
 * Verify a match proof's structural binding before submitting to the chain.
 * Bytes 0-31 must bind to maker commitment, bytes 32-63 to taker commitment.
 * Full threshold sig verification happens on-chain in match_orders.
 */
export function verifyMatchProof(
  matchProof: Uint8Array,
  makerCommitment: Uint8Array,
  takerCommitment: Uint8Array
): boolean {
  if (matchProof.length !== MATCH_PROOF_LEN) return false;
  for (let i = 0; i < 32; i++) {
    if (matchProof[i] !== makerCommitment[i]) return false;
  }
  for (let i = 0; i < 32; i++) {
    if (matchProof[32 + i] !== takerCommitment[i]) return false;
  }
  return true;
}
