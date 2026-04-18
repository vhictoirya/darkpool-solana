import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, setProvider } from "@coral-xyz/anchor";
import { AnchorWallet } from "@solana/wallet-adapter-react";

export const DARKPOOL_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5"
);

export const POOL_STATE_SEED = Buffer.from("pool_state");
export const TRADER_VAULT_SEED = Buffer.from("trader_vault");
export const ORDER_SEED = Buffer.from("order");
export const SETTLEMENT_SEED = Buffer.from("settlement");
export const WITHDRAW_REQUEST_SEED = Buffer.from("withdraw_request");

export function getPoolStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POOL_STATE_SEED], DARKPOOL_PROGRAM_ID);
}

export function getTraderVaultPDA(trader: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TRADER_VAULT_SEED, trader.toBuffer()],
    DARKPOOL_PROGRAM_ID
  );
}

export function getOrderPDA(trader: PublicKey, commitment: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORDER_SEED, trader.toBuffer(), commitment],
    DARKPOOL_PROGRAM_ID
  );
}

export function getSettlementPDA(makerOrder: PublicKey, takerOrder: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SETTLEMENT_SEED, makerOrder.toBuffer(), takerOrder.toBuffer()],
    DARKPOOL_PROGRAM_ID
  );
}

export function createProvider(
  wallet: AnchorWallet,
  connection: Connection
): AnchorProvider {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  setProvider(provider);
  return provider;
}
