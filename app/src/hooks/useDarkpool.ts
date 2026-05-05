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
import {
  encryptOrder,
  encryptBalance,
  createDWallet,
  initiateIkaTransfer,
  saveDWalletShare,
  loadDWalletShare,
  CHAIN_IDS,
  type PlainOrder,
  type ChainId,
} from "../lib/encrypt-browser";
export type { ChainId };

export interface DepositResult {
  signature: string;
  dwalletId: Uint8Array;
  dwalletPublicKey: string;
}

export interface WithdrawResult {
  signature: string;
  ikaTransfer?: {
    txHash: string;
    status: string;
    _source: string;
  };
}

export function useDarkpool() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ikaStatus, setIkaStatus] = useState<string | null>(null);

  const getProgram = useCallback(() => {
    if (!anchorWallet) throw new Error("Wallet not connected");
    const provider = createProvider(anchorWallet, connection);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const idl = require("../lib/darkpool.json");
    return new Program(idl, provider);
  }, [anchorWallet, connection]);

  /**
   * Deposit cross-chain collateral.
   *
   * Creates an Ika dWallet via the 2PC-MPC keygen ceremony, saves the user's
   * encrypted key share to localStorage (required for the 2PC withdrawal signing),
   * encrypts the balance via Encrypt FHE, then writes both to the on-chain vault.
   */
  const deposit = useCallback(
    async (amount: bigint, chain: ChainId): Promise<DepositResult> => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      setIkaStatus(null);
      try {
        const program = getProgram();
        const [poolState] = getPoolStatePDA();
        const [traderVault] = getTraderVaultPDA(wallet.publicKey);

        // 1. Create Ika dWallet (2PC-MPC distributed keygen)
        setIkaStatus("Creating dWallet…");
        const dwallet = await createDWallet(chain, wallet.publicKey);

        // 2. Persist the user's encrypted MPC share — needed for the withdrawal
        //    2PC signing round. Without this, withdrawals cannot complete.
        saveDWalletShare(wallet.publicKey, chain, dwallet);
        setIkaStatus(null);

        // 3. Encrypt deposit amount via Encrypt FHE
        const encryptedBalance = await encryptBalance(null, amount, wallet.publicKey);

        // 4. On-chain deposit instruction
        const tx = await program.methods
          .deposit(
            Array.from(encryptedBalance),
            Array.from(dwallet.id),
            CHAIN_IDS[chain],
          )
          .accounts({
            poolState,
            traderVault,
            trader: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        return { signature: tx, dwalletId: dwallet.id, dwalletPublicKey: dwallet.publicKey };
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
        setIkaStatus(null);
      }
    },
    [getProgram, wallet.publicKey],
  );

  /**
   * Place an encrypted order.
   * Price and size are FHE-encrypted before hitting the network.
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
            new BN(expiry),
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
    [getProgram, wallet.publicKey],
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
    [getProgram, wallet.publicKey],
  );

  /**
   * Withdraw to a native chain address.
   *
   * Two-phase flow:
   * 1. On-chain: `withdraw` instruction emits a WithdrawalRequested event with the
   *    dWallet ID — Ika nodes watch this event as proof of authorisation.
   * 2. Off-chain: load the user's saved MPC share, fetch the WithdrawRequest account
   *    data as the event proof, then call initiateTransfer so Ika nodes can complete
   *    the 2PC threshold signing ceremony and broadcast the native chain transaction.
   */
  const withdraw = useCallback(
    async (
      amount: bigint,
      destinationChain: ChainId,
      destinationAddress: string,
    ): Promise<WithdrawResult> => {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      setLoading(true);
      setError(null);
      setIkaStatus(null);
      try {
        const program = getProgram();
        const [poolState] = getPoolStatePDA();
        const [traderVault] = getTraderVaultPDA(wallet.publicKey);

        const destBytes = new Uint8Array(64);
        const addrBytes = new TextEncoder().encode(destinationAddress);
        destBytes.set(addrBytes.slice(0, 64));

        const [withdrawRequest] = PublicKey.findProgramAddressSync(
          [Buffer.from("withdraw_request"), wallet.publicKey.toBuffer(), destBytes.slice(0, 32)],
          DARKPOOL_PROGRAM_ID,
        );

        // Phase 1: on-chain instruction — emits WithdrawalRequested event
        const tx = await program.methods
          .withdraw(
            new BN(amount.toString()),
            CHAIN_IDS[destinationChain],
            Array.from(destBytes),
          )
          .accounts({
            poolState,
            traderVault,
            withdrawRequest,
            trader: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // Phase 2: load user's MPC share and trigger Ika 2PC signing ceremony
        const saved = loadDWalletShare(wallet.publicKey, destinationChain);
        if (!saved) {
          // No saved share — Ika nodes can still detect the event via their own
          // monitoring, but the 2PC round requires the user share to complete.
          return { signature: tx };
        }

        setIkaStatus("Signing with Ika…");

        // Fetch the WithdrawRequest account data as the event proof.
        // Ika nodes re-derive the PDA and verify against Solana finality.
        const accountInfo = await connection.getAccountInfo(withdrawRequest, "finalized");
        const withdrawProof = accountInfo
          ? new Uint8Array(accountInfo.data as Buffer)
          : new Uint8Array(0);

        // Submit user share + proof to the Ika MPC network
        const transfer = await initiateIkaTransfer(
          saved.id,
          saved.userShareEncrypted,
          destinationAddress,
          amount,
          destinationChain,
          withdrawProof,
        );

        setIkaStatus(
          transfer.status === "confirmed"
            ? "Transfer confirmed on-chain"
            : "Transfer submitted — awaiting confirmations",
        );

        return {
          signature: tx,
          ikaTransfer: {
            txHash: transfer.txHash,
            status: transfer.status,
            _source: transfer._source,
          },
        };
      } catch (e: any) {
        setError(e.message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [getProgram, wallet.publicKey, connection],
  );

  return { deposit, placeOrder, cancelOrder, withdraw, loading, error, ikaStatus };
}
