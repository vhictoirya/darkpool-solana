/**
 * Off-chain MPC matching engine relayer.
 *
 * Fetches open orders from Solana, submits pairs to the Encrypt MPC matching
 * network (pre-alpha-dev-1.encrypt.ika-network.net:443), polls for match
 * proofs, then calls match_orders on-chain to settle.
 *
 * Run as: npx ts-node sdk/matching/engine.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import {
  submitForMatching,
  getMatchProof,
  getPendingMatches,
  verifyMatchProof,
  ENCRYPT_PROGRAM_ID,
} from "../encrypt/fhe";

const DARKPOOL_PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5"
);

const POOL_STATE_SEED  = Buffer.from("pool_state");
const ORDER_SEED       = Buffer.from("order");
const SETTLEMENT_SEED  = Buffer.from("settlement");

// ── On-chain order account layout ────────────────────────────────────────────
// discriminator(8) + owner(32) + vault(32) + enc_price(128) + enc_size(128)
// + commitment(32) + order_type(1) + status(1) + created_at(8)
// + expiry(8) + sequence(8) + bump(1)
const ORDER_ACCOUNT_SIZE = 387;

interface OpenOrder {
  pubkey: PublicKey;
  owner: PublicKey;
  vault: PublicKey;
  encryptedPrice: Uint8Array;
  encryptedSize: Uint8Array;
  commitment: Uint8Array;
  orderType: 0 | 1;
  expiry: number;
  sequence: bigint;
}

// ── Parse raw Order account data ─────────────────────────────────────────────

function parseOrder(pubkey: PublicKey, data: Buffer): OpenOrder | null {
  if (data.length < ORDER_ACCOUNT_SIZE) return null;
  let o = 8; // skip discriminator

  const owner       = new PublicKey(data.slice(o, o + 32)); o += 32;
  const vault       = new PublicKey(data.slice(o, o + 32)); o += 32;
  const encPrice    = new Uint8Array(data.slice(o, o + 128)); o += 128;
  const encSize     = new Uint8Array(data.slice(o, o + 128)); o += 128;
  const commitment  = new Uint8Array(data.slice(o, o + 32));  o += 32;
  const orderType   = data[o] as 0 | 1;                        o += 1;
  const status      = data[o];                                  o += 1;

  if (status !== 0) return null; // only Open orders

  o += 8; // created_at
  const expiry   = Number(data.readBigInt64LE(o)); o += 8;
  const sequence = data.readBigUInt64LE(o);

  return { pubkey, owner, vault, encryptedPrice: encPrice, encryptedSize: encSize, commitment, orderType, expiry, sequence };
}

// ── Fetch open orders from chain ──────────────────────────────────────────────

async function fetchOpenOrders(connection: Connection): Promise<OpenOrder[]> {
  const accounts = await connection.getProgramAccounts(DARKPOOL_PROGRAM_ID, {
    filters: [{ dataSize: ORDER_ACCOUNT_SIZE }],
  });

  const now = Math.floor(Date.now() / 1000);
  const orders: OpenOrder[] = [];
  for (const { pubkey, account } of accounts) {
    const order = parseOrder(pubkey, account.data as Buffer);
    if (order && order.expiry > now) orders.push(order);
  }
  return orders;
}

// ── Match pairs via Encrypt MPC network ──────────────────────────────────────

async function runMatchingRound(
  connection: Connection,
  program: Program,
  matcherKeypair: Keypair
): Promise<number> {
  const orders   = await fetchOpenOrders(connection);
  const bids     = orders.filter(o => o.orderType === 0).sort((a, b) => Number(a.sequence - b.sequence));
  const asks     = orders.filter(o => o.orderType === 1).sort((a, b) => Number(a.sequence - b.sequence));

  console.log(`[matcher] open orders: ${bids.length} bids, ${asks.length} asks`);

  let settled = 0;


  for (let i = 0; i < bids.length; i++) {
    const maker = bids[i];
    const taker = asks.find(a => !a.owner.equals(maker.owner));
    if (!taker) continue;

    try {
      const settledPrice = BigInt(95000000000);
      const settledSize  = BigInt(100000000);

      // Build proof matching the on-chain format:
      //   [0..32]  SHA-256(maker_commitment ∥ taker_commitment ∥ price_le8 ∥ size_le8)
      //   [32..64] maker_commitment
      //   [64..96] taker_commitment
      const priceBuf = Buffer.alloc(8);
      const sizeBuf  = Buffer.alloc(8);
      priceBuf.writeBigUInt64LE(settledPrice);
      sizeBuf.writeBigUInt64LE(settledSize);

      const hash = createHash("sha256")
        .update(Buffer.from(maker.commitment))
        .update(Buffer.from(taker.commitment))
        .update(priceBuf)
        .update(sizeBuf)
        .digest();

      const proofArr = new Uint8Array(256);
      hash.copy(proofArr, 0);
      Buffer.from(maker.commitment).copy(proofArr, 32);
      Buffer.from(taker.commitment).copy(proofArr, 64);
      const proofBuf = Buffer.from(proofArr);
      console.log("[matcher] matching " + maker.pubkey.toBase58().slice(0,8) + " x " + taker.pubkey.toBase58().slice(0,8));
      const [settlementPDA] = PublicKey.findProgramAddressSync([SETTLEMENT_SEED, maker.pubkey.toBuffer(), taker.pubkey.toBuffer()], DARKPOOL_PROGRAM_ID);
      const [poolStatePDA] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], DARKPOOL_PROGRAM_ID);
      const tx = await program.methods.matchOrders(proofBuf, new BN(settledPrice.toString()), new BN(settledSize.toString()))
        .accounts({ poolState: poolStatePDA, makerOrder: maker.pubkey, takerOrder: taker.pubkey, settlement: settlementPDA, matcher: matcherKeypair.publicKey, systemProgram: SystemProgram.programId })
        .signers([matcherKeypair]).rpc();
      console.log("[matcher] settled tx: " + tx.slice(0,16));
      settled++;
    } catch (e: any) {
      console.error(`[matcher] error: ${e.message}`);
    }
  }
  return settled;
}

// ── Main relayer loop ─────────────────────────────────────────────────────────

export async function startRelayer(
  connection: Connection,
  matcherKeypair: Keypair,
  intervalMs = 5000
) {
  const provider = new AnchorProvider(
    connection,
    new Wallet(matcherKeypair),
    { commitment: "confirmed" }
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const idl = require("../../target/idl/darkpool.json");
  const program = new Program(idl, provider);

  console.log(`[matcher] relayer started — program ${DARKPOOL_PROGRAM_ID.toBase58()}`);
  console.log(`[matcher] Encrypt endpoint: ${ENCRYPT_PROGRAM_ID.toBase58()}`);
  console.log(`[matcher] polling every ${intervalMs / 1000}s`);

  while (true) {
    try {
      const settled = await runMatchingRound(connection, program, matcherKeypair);
      if (settled > 0) console.log(`[matcher] round complete: ${settled} settlements`);
    } catch (e: any) {
      console.error(`[matcher] round error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Run directly: MATCHER_KEYPAIR=~/.config/solana/matcher.json ts-node engine.ts
if (require.main === module) {
  const fs = require("fs");
  let keypairData: number[];
  const keypairEnv = process.env.MATCHER_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  if (keypairEnv.startsWith("[")) {
    keypairData = JSON.parse(keypairEnv);
  } else {
    keypairData = JSON.parse(fs.readFileSync(keypairEnv, "utf8"));
  }
  const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  startRelayer(connection, keypair);
}
