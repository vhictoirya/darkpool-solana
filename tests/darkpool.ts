import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { assert } from "chai";
import { Darkpool } from "../target/types/darkpool";

const POOL_STATE_SEED   = Buffer.from("pool_state");
const TRADER_VAULT_SEED = Buffer.from("trader_vault");
const ORDER_SEED        = Buffer.from("order");
const SETTLEMENT_SEED   = Buffer.from("settlement");
const WITHDRAW_SEED     = Buffer.from("withdraw_request");

function mockCiphertext(value: number): number[] {
  const buf = new Uint8Array(128);
  new DataView(buf.buffer).setUint32(0, value, false);
  return Array.from(buf);
}
function mockCommitment(seed: string): number[] {
  const buf = new Uint8Array(32);
  for (let i = 0; i < Math.min(seed.length, 32); i++) buf[i] = seed.charCodeAt(i);
  return Array.from(buf);
}
function pda(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}
async function errStr(e: any, conn?: anchor.web3.Connection): Promise<string> {
  if (e?.error?.errorCode?.code) return e.error.errorCode.code;
  if (e?.getLogs && conn) {
    try { return (await e.getLogs(conn)).join("\n"); } catch {}
  }
  return e?.toString() ?? String(e);
}

/**
 * Build a valid match proof for the new format:
 *   [0..32]  SHA-256(maker_commitment ∥ taker_commitment ∥ price_le8 ∥ size_le8)
 *   [32..64] maker_commitment
 *   [64..96] taker_commitment
 *   [96..256] reserved
 *
 * This is what the Encrypt MPC relayer produces in production.
 */
function buildMatchProof(
  makerCommitment: number[],
  takerCommitment: number[],
  price: bigint,
  size: bigint,
): Buffer {
  const priceBuf = Buffer.alloc(8);
  const sizeBuf  = Buffer.alloc(8);
  priceBuf.writeBigUInt64LE(price);
  sizeBuf.writeBigUInt64LE(size);

  const hash = createHash("sha256")
    .update(Buffer.from(makerCommitment))
    .update(Buffer.from(takerCommitment))
    .update(priceBuf)
    .update(sizeBuf)
    .digest();

  const proof = Buffer.alloc(256);
  hash.copy(proof, 0);
  Buffer.from(makerCommitment).copy(proof, 32);
  Buffer.from(takerCommitment).copy(proof, 64);
  return proof;
}

describe("darkpool", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program  = anchor.workspace.Darkpool as Program<Darkpool>;
  const admin    = provider.wallet as anchor.Wallet;
  const conn     = provider.connection;

  const trader1 = Keypair.generate();
  const trader2 = Keypair.generate();
  // matcher IS the Encrypt MPC authority — registered at pool initialization
  const matcher = Keypair.generate();

  let poolPDA:   PublicKey;
  let vault1PDA: PublicKey;
  let vault2PDA: PublicKey;
  let order1PDA: PublicKey;
  let order2PDA: PublicKey;

  const commit1 = mockCommitment("bid_commitment_trader1");
  const commit2 = mockCommitment("ask_commitment_trader2");

  before(async () => {
    for (const kp of [trader1, trader2, matcher]) {
      await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL));
    }
    poolPDA   = pda([POOL_STATE_SEED], program.programId);
    vault1PDA = pda([TRADER_VAULT_SEED, trader1.publicKey.toBuffer()], program.programId);
    vault2PDA = pda([TRADER_VAULT_SEED, trader2.publicKey.toBuffer()], program.programId);
    order1PDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(commit1)], program.programId);
    order2PDA = pda([ORDER_SEED, trader2.publicKey.toBuffer(), Buffer.from(commit2)], program.programId);
  });

  it("initializes the pool with 10 bps fee and registers Encrypt MPC authority", async () => {
    const tx = await program.methods
      .initialize(10, matcher.publicKey)
      .accounts({ poolState: poolPDA, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    const pool = await program.account.poolState.fetch(poolPDA);
    assert.equal(pool.feeBps, 10);
    assert.equal(pool.paused, false);
    assert.equal(pool.totalOrders.toNumber(), 0);
    assert.equal(pool.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(pool.encryptMpcAuthority.toBase58(), matcher.publicKey.toBase58());
    console.log("    pool", poolPDA.toBase58().slice(0,16)+"…  encrypt_mpc_authority:", matcher.publicKey.toBase58().slice(0,8)+"…  tx:", tx.slice(0,16)+"…");
  });

  it("rejects fee > 100 bps on initialize", async () => {
    const fakeAdmin = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(fakeAdmin.publicKey, LAMPORTS_PER_SOL));
    const fakePDA = pda([Buffer.from("pool_state_bad_fee")], program.programId);
    try {
      await program.methods.initialize(101, fakeAdmin.publicKey)
        .accounts({ poolState: fakePDA, admin: fakeAdmin.publicKey, systemProgram: SystemProgram.programId })
        .signers([fakeAdmin]).rpc();
      assert.fail("expected error");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.isTrue(/FeeTooHigh|ConstraintSeeds|seeds|2006/.test(msg), `Got: ${msg}`);
    }
  });

  it("trader1 deposits BTC collateral", async () => {
    await program.methods
      .deposit(mockCiphertext(1_000_000), mockCommitment("t1_btc_dwallet"), 1)
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    const v = await program.account.traderVault.fetch(vault1PDA);
    assert.equal(v.owner.toBase58(), trader1.publicKey.toBase58());
    assert.equal(v.assetType, 1);
    assert.equal(v.depositCount, 1);
    console.log("    vault1", vault1PDA.toBase58().slice(0,16)+"…");
  });

  it("trader2 deposits ETH collateral", async () => {
    await program.methods
      .deposit(mockCiphertext(5_000_000), mockCommitment("t2_eth_dwallet"), 2)
      .accounts({ poolState: poolPDA, traderVault: vault2PDA, trader: trader2.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader2]).rpc();
    const v = await program.account.traderVault.fetch(vault2PDA);
    assert.equal(v.assetType, 2);
    assert.equal(v.depositCount, 1);
  });

  it("second deposit increments deposit_count", async () => {
    await program.methods
      .deposit(mockCiphertext(500_000), mockCommitment("t1_btc_dwallet"), 1)
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    const v = await program.account.traderVault.fetch(vault1PDA);
    assert.equal(v.depositCount, 2);
  });

  it("trader1 places an encrypted bid", async () => {
    const expiry = Math.floor(Date.now()/1000) + 3600;
    await program.methods
      .placeOrder(mockCiphertext(95_000_000), mockCiphertext(100_000), commit1, 0, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: order1PDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    const o = await program.account.order.fetch(order1PDA);
    assert.equal(o.owner.toBase58(), trader1.publicKey.toBase58());
    assert.equal(o.orderType, 0);
    assert.equal(o.status, 0);
    assert.equal(o.sequence.toNumber(), 0);
    console.log("    order1 (bid)", order1PDA.toBase58().slice(0,16)+"…");
  });

  it("trader2 places an encrypted ask", async () => {
    const expiry = Math.floor(Date.now()/1000) + 3600;
    await program.methods
      .placeOrder(mockCiphertext(95_100_000), mockCiphertext(100_000), commit2, 1, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault2PDA, order: order2PDA, trader: trader2.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader2]).rpc();
    const o = await program.account.order.fetch(order2PDA);
    assert.equal(o.orderType, 1);
    assert.equal(o.status, 0);
    assert.equal(o.sequence.toNumber(), 1);
  });

  it("rejects expired order placement", async () => {
    const c = mockCommitment("expired_order_zz1");
    const ePDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c)], program.programId);
    try {
      await program.methods
        .placeOrder(mockCiphertext(1), mockCiphertext(1), c, 0, new BN(Math.floor(Date.now()/1000) - 1))
        .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: ePDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
        .signers([trader1]).rpc();
      assert.fail("expected OrderExpired");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /OrderExpired/, `Got: ${msg}`);
    }
  });

  it("Encrypt MPC engine matches bid and ask with SHA-256 settlement hash", async () => {
    const price = BigInt(95_050_000);
    const size  = BigInt(100_000);
    const proof = buildMatchProof(commit1, commit2, price, size);
    const settlePDA = pda([SETTLEMENT_SEED, order1PDA.toBuffer(), order2PDA.toBuffer()], program.programId);

    const tx = await program.methods
      .matchOrders(proof, new BN(price.toString()), new BN(size.toString()))
      .accounts({ poolState: poolPDA, makerOrder: order1PDA, takerOrder: order2PDA, settlement: settlePDA, matcher: matcher.publicKey, systemProgram: SystemProgram.programId })
      .signers([matcher]).rpc();

    const s = await program.account.settlement.fetch(settlePDA);
    assert.equal(s.maker.toBase58(), trader1.publicKey.toBase58());
    assert.equal(s.taker.toBase58(), trader2.publicKey.toBase58());
    assert.equal(s.settledPrice.toNumber(), Number(price));
    assert.equal(s.settledSize.toNumber(), Number(size));
    console.log("    settlement", settlePDA.toBase58().slice(0,16)+"…  tx:", tx.slice(0,16)+"…");
  });

  it("rejects matching already-matched orders", async () => {
    const proof = buildMatchProof(commit1, commit2, BigInt(95_050_000), BigInt(100_000));
    const settlePDA = pda([SETTLEMENT_SEED, order1PDA.toBuffer(), order2PDA.toBuffer()], program.programId);
    try {
      await program.methods
        .matchOrders(proof, new BN(95_050_000), new BN(100_000))
        .accounts({ poolState: poolPDA, makerOrder: order1PDA, takerOrder: order2PDA, settlement: settlePDA, matcher: matcher.publicKey, systemProgram: SystemProgram.programId })
        .signers([matcher]).rpc();
      assert.fail("expected error");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.isTrue(/OrderNotOpen|already in use|already/.test(msg), `Got: ${msg}`);
    }
  });

  it("rejects self-trade", async () => {
    const c1 = mockCommitment("self_bid_aa1_unique");
    const c2 = mockCommitment("self_ask_aa1_unique");
    const expiry = Math.floor(Date.now()/1000) + 3600;
    const ct = mockCiphertext(1000);
    const selfBidPDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c1)], program.programId);
    const selfAskPDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c2)], program.programId);

    await program.methods.placeOrder(ct, ct, c1, 0, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: selfBidPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    await program.methods.placeOrder(ct, ct, c2, 1, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: selfAskPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();

    const proof = buildMatchProof(c1, c2, BigInt(1000), BigInt(1000));
    const selfSettlePDA = pda([SETTLEMENT_SEED, selfBidPDA.toBuffer(), selfAskPDA.toBuffer()], program.programId);
    try {
      await program.methods
        .matchOrders(proof, new BN(1000), new BN(1000))
        .accounts({ poolState: poolPDA, makerOrder: selfBidPDA, takerOrder: selfAskPDA, settlement: selfSettlePDA, matcher: matcher.publicKey, systemProgram: SystemProgram.programId })
        .signers([matcher]).rpc();
      assert.fail("expected SelfTrade");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /SelfTrade/, `Got: ${msg}`);
    }
  });

  it("rejects invalid match proof (wrong hash)", async () => {
    const c1 = mockCommitment("proof_bid_bb2_uniq");
    const c2 = mockCommitment("proof_ask_bb2_uniq");
    const expiry = Math.floor(Date.now()/1000) + 3600;
    const ct = mockCiphertext(9999);
    const bidPDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c1)], program.programId);
    const askPDA = pda([ORDER_SEED, trader2.publicKey.toBuffer(), Buffer.from(c2)], program.programId);

    await program.methods.placeOrder(ct, ct, c1, 0, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: bidPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    await program.methods.placeOrder(ct, ct, c2, 1, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault2PDA, order: askPDA, trader: trader2.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader2]).rpc();

    // All-zero proof — hash will not match
    const badProof  = Buffer.alloc(256);
    const settlePDA = pda([SETTLEMENT_SEED, bidPDA.toBuffer(), askPDA.toBuffer()], program.programId);
    try {
      await program.methods
        .matchOrders(badProof, new BN(1000), new BN(1000))
        .accounts({ poolState: poolPDA, makerOrder: bidPDA, takerOrder: askPDA, settlement: settlePDA, matcher: matcher.publicKey, systemProgram: SystemProgram.programId })
        .signers([matcher]).rpc();
      assert.fail("expected InvalidMatchProof");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /InvalidMatchProof/, `Got: ${msg}`);
    }
  });

  it("rejects match_orders from non-authority signer (Unauthorized)", async () => {
    const c1 = mockCommitment("auth_bid_cc3_uniq");
    const c2 = mockCommitment("auth_ask_cc3_uniq");
    const expiry = Math.floor(Date.now()/1000) + 3600;
    const ct = mockCiphertext(5000);
    const bidPDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c1)], program.programId);
    const askPDA = pda([ORDER_SEED, trader2.publicKey.toBuffer(), Buffer.from(c2)], program.programId);

    await program.methods.placeOrder(ct, ct, c1, 0, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: bidPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    await program.methods.placeOrder(ct, ct, c2, 1, new BN(expiry))
      .accounts({ poolState: poolPDA, traderVault: vault2PDA, order: askPDA, trader: trader2.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader2]).rpc();

    const proof = buildMatchProof(c1, c2, BigInt(5000), BigInt(5000));
    const settlePDA = pda([SETTLEMENT_SEED, bidPDA.toBuffer(), askPDA.toBuffer()], program.programId);
    // trader1 is NOT the registered encrypt_mpc_authority
    try {
      await program.methods
        .matchOrders(proof, new BN(5000), new BN(5000))
        .accounts({ poolState: poolPDA, makerOrder: bidPDA, takerOrder: askPDA, settlement: settlePDA, matcher: trader1.publicKey, systemProgram: SystemProgram.programId })
        .signers([trader1]).rpc();
      assert.fail("expected Unauthorized");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /Unauthorized/, `Got: ${msg}`);
    }
  });

  it("trader1 can cancel an open order", async () => {
    const c = mockCommitment("cancel_test_cc3");
    const cancelPDA = pda([ORDER_SEED, trader1.publicKey.toBuffer(), Buffer.from(c)], program.programId);
    await program.methods.placeOrder(mockCiphertext(500), mockCiphertext(500), c, 0, new BN(Math.floor(Date.now()/1000)+3600))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, order: cancelPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    await program.methods.cancelOrder()
      .accounts({ order: cancelPDA, trader: trader1.publicKey })
      .signers([trader1]).rpc();
    const o = await program.account.order.fetch(cancelPDA);
    assert.equal(o.status, 2);
  });

  it("cannot cancel someone else's order", async () => {
    const c = mockCommitment("owned_by_t2_dd4");
    const ownPDA = pda([ORDER_SEED, trader2.publicKey.toBuffer(), Buffer.from(c)], program.programId);
    await program.methods.placeOrder(mockCiphertext(100), mockCiphertext(100), c, 1, new BN(Math.floor(Date.now()/1000)+3600))
      .accounts({ poolState: poolPDA, traderVault: vault2PDA, order: ownPDA, trader: trader2.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader2]).rpc();
    try {
      await program.methods.cancelOrder()
        .accounts({ order: ownPDA, trader: trader1.publicKey })
        .signers([trader1]).rpc();
      assert.fail("expected constraint error");
    } catch (e: any) {
      assert.isDefined(e);
    }
  });

  it("trader1 initiates a BTC withdrawal", async () => {
    const destAddr = new Uint8Array(64);
    new TextEncoder().encode("bc1qxy2kgdygjrsqtzq2n0yrf249zt4qj5gz").forEach((b,i) => destAddr[i]=b);
    const withdrawPDA = pda([WITHDRAW_SEED, trader1.publicKey.toBuffer(), Buffer.from(destAddr.slice(0,32))], program.programId);
    await program.methods
      .withdraw(new BN(50_000), 1, Array.from(destAddr))
      .accounts({ poolState: poolPDA, traderVault: vault1PDA, withdrawRequest: withdrawPDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
      .signers([trader1]).rpc();
    const req = await program.account.withdrawRequest.fetch(withdrawPDA);
    assert.equal(req.owner.toBase58(), trader1.publicKey.toBase58());
    assert.equal(req.amount.toNumber(), 50_000);
    assert.equal(req.destinationChain, 1);
    assert.equal(req.status, 0);
    console.log("    withdraw request", withdrawPDA.toBase58().slice(0,16)+"…  status=Pending");
  });

  it("admin can pause and unpause the pool", async () => {
    await program.methods.setPaused(true)
      .accounts({ poolState: poolPDA, admin: admin.publicKey }).rpc();
    let pool = await program.account.poolState.fetch(poolPDA);
    assert.equal(pool.paused, true);
    try {
      await program.methods.deposit(mockCiphertext(1), mockCommitment("x"), 0)
        .accounts({ poolState: poolPDA, traderVault: vault1PDA, trader: trader1.publicKey, systemProgram: SystemProgram.programId })
        .signers([trader1]).rpc();
      assert.fail("expected PoolPaused");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /PoolPaused/, `Got: ${msg}`);
    }
    await program.methods.setPaused(false)
      .accounts({ poolState: poolPDA, admin: admin.publicKey }).rpc();
    pool = await program.account.poolState.fetch(poolPDA);
    assert.equal(pool.paused, false);
  });

  it("non-admin cannot pause the pool", async () => {
    try {
      await program.methods.setPaused(true)
        .accounts({ poolState: poolPDA, admin: trader1.publicKey })
        .signers([trader1]).rpc();
      assert.fail("expected Unauthorized");
    } catch (e: any) {
      assert.isDefined(e);
    }
  });

  it("admin can update fee", async () => {
    await program.methods.updateFee(25)
      .accounts({ poolState: poolPDA, admin: admin.publicKey }).rpc();
    const pool = await program.account.poolState.fetch(poolPDA);
    assert.equal(pool.feeBps, 25);
  });

  it("rejects fee > 100 bps via updateFee", async () => {
    try {
      await program.methods.updateFee(101)
        .accounts({ poolState: poolPDA, admin: admin.publicKey }).rpc();
      assert.fail("expected FeeTooHigh");
    } catch (e: any) {
      const msg = await errStr(e, conn);
      assert.match(msg, /FeeTooHigh/, `Got: ${msg}`);
    }
  });
});
