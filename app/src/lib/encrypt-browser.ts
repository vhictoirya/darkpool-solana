import { PublicKey } from '@solana/web3.js';

export const CIPHERTEXT_LEN = 128;

export interface PlainOrder { price: bigint; size: bigint; orderType: 'bid' | 'ask'; }
export interface EncryptedOrder { encryptedPrice: Uint8Array; encryptedSize: Uint8Array; orderCommitment: Uint8Array; sessionId: string; }
export type ChainId = 'solana' | 'bitcoin' | 'ethereum';
export const CHAIN_IDS: Record<ChainId, number> = { solana: 0, bitcoin: 1, ethereum: 2 };

export interface DWallet {
  id: Uint8Array;
  publicKey: string;
  chain: ChainId;
  userShareEncrypted: Uint8Array;
  sessionId: string;
}

export interface IkaTransferResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  sessionId: string;
  _source: string;
}

// ── Encrypt FHE ──────────────────────────────────────────────────────────────

export async function encryptOrder(order: PlainOrder, owner: PublicKey): Promise<EncryptedOrder> {
  const res = await fetch('/api/encrypt/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price: order.price.toString(),
      size: order.size.toString(),
      orderType: order.orderType,
      ownerPubkey: Buffer.from(owner.toBytes()).toString('base64'),
    }),
  });
  const data = await res.json();
  return {
    encryptedPrice: new Uint8Array(Buffer.from(data.encryptedPrice, 'base64')),
    encryptedSize: new Uint8Array(Buffer.from(data.encryptedSize, 'base64')),
    orderCommitment: new Uint8Array(Buffer.from(data.orderCommitment, 'base64')),
    sessionId: data.sessionId,
  };
}

export async function encryptBalance(current: Uint8Array | null, amount: bigint, owner: PublicKey): Promise<Uint8Array> {
  const res = await fetch('/api/encrypt/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentEncrypted: current ? Buffer.from(current).toString('base64') : null,
      depositAmount: amount.toString(),
      ownerPubkey: Buffer.from(owner.toBytes()).toString('base64'),
    }),
  });
  const data = await res.json();
  return new Uint8Array(Buffer.from(data.encryptedBalance, 'base64'));
}

// ── Ika dWallet ───────────────────────────────────────────────────────────────

export async function createDWallet(chain: ChainId, owner: PublicKey): Promise<DWallet> {
  const res = await fetch('/api/ika/dwallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain, ownerPubkey: owner.toBase58() }),
  });
  const data = await res.json();
  return {
    id: new Uint8Array(Buffer.from(data.dwalletId, 'base64')),
    publicKey: data.publicKey,
    chain,
    userShareEncrypted: new Uint8Array(Buffer.from(data.userShareEncrypted, 'base64')),
    sessionId: data.sessionId,
  };
}

/**
 * Initiate the Ika 2PC signing ceremony for a cross-chain withdrawal.
 * The withdrawProof is the raw account data of the on-chain WithdrawRequest,
 * which Ika nodes verify against Solana finality before co-signing.
 */
export async function initiateIkaTransfer(
  dwalletId: Uint8Array,
  userShareEncrypted: Uint8Array,
  destination: string,
  amount: bigint,
  chain: ChainId,
  withdrawProof: Uint8Array,
): Promise<IkaTransferResult> {
  const res = await fetch('/api/ika/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dwalletId: Buffer.from(dwalletId).toString('base64'),
      userShareEncrypted: Buffer.from(userShareEncrypted).toString('base64'),
      destination,
      amount: amount.toString(),
      chain,
      withdrawProof: Buffer.from(withdrawProof).toString('base64'),
    }),
  });
  return res.json();
}

export async function pollIkaTransferStatus(
  txHash: string,
): Promise<{ status: 'pending' | 'confirmed' | 'failed'; confirmations: number }> {
  const res = await fetch(`/api/ika/transfer?txHash=${encodeURIComponent(txHash)}`);
  return res.json();
}

// ── dWallet local key store ───────────────────────────────────────────────────
// The user's encrypted MPC share must survive page reloads so withdrawals can
// complete the 2PC signing round. Stored in localStorage keyed by owner + chain.

const shareKey = (owner: PublicKey, chain: ChainId) =>
  `dwallet:${owner.toBase58()}:${chain}`;

export function saveDWalletShare(owner: PublicKey, chain: ChainId, dwallet: DWallet): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(shareKey(owner, chain), JSON.stringify({
    id: Buffer.from(dwallet.id).toString('base64'),
    publicKey: dwallet.publicKey,
    userShareEncrypted: Buffer.from(dwallet.userShareEncrypted).toString('base64'),
  }));
}

export function loadDWalletShare(
  owner: PublicKey,
  chain: ChainId,
): { id: Uint8Array; publicKey: string; userShareEncrypted: Uint8Array } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(shareKey(owner, chain));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      id: new Uint8Array(Buffer.from(parsed.id, 'base64')),
      publicKey: parsed.publicKey,
      userShareEncrypted: new Uint8Array(Buffer.from(parsed.userShareEncrypted, 'base64')),
    };
  } catch {
    return null;
  }
}
