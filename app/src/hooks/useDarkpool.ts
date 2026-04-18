import { useCallback, useState } from "react";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import {
  createProvider,
  DARKPOOL_PROGRAM_ID,
  getPoolStatePDA,
  getTraderVaultPDA,
  getOrderPDA,
} from "../lib/program";
import { encryptOrder, encryptBalance, type PlainOrder } from "../lib/encrypt-browser";
import { createDWallet, CHAIN_IDS, type ChainId } from "../lib/encrypt-browser";
export type { ChainId };

export function useDarkpool() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getProgram = useCallback(() => {
    if (!anchorWallet) throw new Error("Wallet not connected");
    const provider = createProvider(anchorWallet, connection);
    // IDL is loaded from the build artifact
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const idl = require("../lib/darkpool.json");
    return new Program(idl, provider);
  }, [anchorWallet, connection]);

  /**
   * Deposit cross-chain collateral into the dark pool.
   * Creates an Ika dWallet for the asset, encrypts the balance,
   * and calls the on-chain deposit instruction.
   */
  const deposit = useCallback(
    async (amount: bigint, chain: ChainId) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        const program = getProgram();
        const [poolState] = getPoolStatePDA();
        const [traderVault] = getTraderVaultPDA(wallet.publicKey);

        // Create or retrieve dWallet for this chain via Ika gRPC
        // Program: DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq
        const dwallet = await createDWallet(chain, wallet.publicKey);

        // Encrypt deposit amount via Encrypt FHE gRPC
        // Program: 4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8
        const encryptedBalance = await encryptBalance(null, amount, wallet.publicKey);

        const tx = await program.methods
          .deposit(
            Array.from(encryptedBalance),
            Array.from(dwallet.id),
            CHAIN_IDS[chain]
          )
          .accounts({
            poolState,
            traderVault,
            trader: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        return { signature: tx, dwalletId: dwallet.id };
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [getProgram, wallet.publicKey]
  );

  /**
   * Place an encrypted order. Price and size are FHE-encrypted before
   * hitting the network — no one can see your order parameters.
   */
  const placeOrder = useCallback(
    async (order: PlainOrder, expirySeconds = 3600) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        const program = getProgram();
        const [poolState] = getPoolStatePDA();
        const [traderVault] = getTraderVaultPDA(wallet.publicKey);

        const encrypted = await encryptOrder(order, wallet.publicKey);
        const expiry = Math.floor(Date.now() / 1000) + expirySeconds;
        const [orderPDA] = getOrderPDA(wallet.publicKey, encrypted.orderCommitment);

        const tx = await program.methods
          .placeOrder(
            Array.from(encrypted.encryptedPrice),
            Array.from(encrypted.encryptedSize),
            Array.from(encrypted.orderCommitment),
            order.orderType === "bid" ? 0 : 1,
            new BN(expiry)
          )
          .accounts({
            poolState,
            traderVault,
            order: orderPDA,
            trader: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        return { signature: tx, orderAddress: orderPDA.toBase58(), commitment: encrypted.orderCommitment };
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [getProgram, wallet.publicKey]
  );

  /**
   * Cancel an open order.
   */
  const cancelOrder = useCallback(
    async (orderAddress: string) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        const program = getProgram();
        const tx = await program.methods
          .cancelOrder()
          .accounts({
            order: new PublicKey(orderAddress),
            trader: wallet.publicKey,
          })
          .rpc();
        return tx;
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [getProgram, wallet.publicKey]
  );

  /**
   * Initiate a withdrawal. For BTC/ETH, emits a WithdrawalRequested event
   * that Ika nodes pick up to sign the cross-chain transaction.
   */
  const withdraw = useCallback(
    async (amount: bigint, destinationChain: ChainId, destinationAddress: string) => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      try {
        const program = getProgram();
        const [poolState] = getPoolStatePDA();
        const [traderVault] = getTraderVaultPDA(wallet.publicKey);

        const destBytes = new Uint8Array(64);
        const encoder = new TextEncoder();
        const addrBytes = encoder.encode(destinationAddress);
        destBytes.set(addrBytes.slice(0, 64));

        const withdrawSeed = destBytes.slice(0, 32);
        const [withdrawRequest] = PublicKey.findProgramAddressSync(
          [Buffer.from("withdraw_request"), wallet.publicKey.toBuffer(), withdrawSeed],
          DARKPOOL_PROGRAM_ID
        );

        const tx = await program.methods
          .withdraw(
            new BN(amount.toString()),
            CHAIN_IDS[destinationChain],
            Array.from(destBytes)
          )
          .accounts({
            poolState,
            traderVault,
            withdrawRequest,
            trader: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        return tx;
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [getProgram, wallet.publicKey]
  );

  return { deposit, placeOrder, cancelOrder, withdraw, loading, error };
}
