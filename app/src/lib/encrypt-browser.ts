import { PublicKey } from '@solana/web3.js';

export const CIPHERTEXT_LEN = 128;

export interface PlainOrder { price: bigint; size: bigint; orderType: 'bid' | 'ask'; }
export interface EncryptedOrder { encryptedPrice: Uint8Array; encryptedSize: Uint8Array; orderCommitment: Uint8Array; sessionId: string; }
export type ChainId = 'solana' | 'bitcoin' | 'ethereum';
export const CHAIN_IDS: Record<ChainId, number> = { solana: 0, bitcoin: 1, ethereum: 2 };

export async function encryptOrder(order: PlainOrder, owner: PublicKey): Promise<EncryptedOrder> {
  const res = await fetch('/api/encrypt/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: order.price.toString(), size: order.size.toString(), orderType: order.orderType, ownerPubkey: Buffer.from(owner.toBytes()).toString('base64') }) });
  const data = await res.json();
  return { encryptedPrice: new Uint8Array(Buffer.from(data.encryptedPrice, 'base64')), encryptedSize: new Uint8Array(Buffer.from(data.encryptedSize, 'base64')), orderCommitment: new Uint8Array(Buffer.from(data.orderCommitment, 'base64')), sessionId: data.sessionId };
}

export async function encryptBalance(current: Uint8Array | null, amount: bigint, owner: PublicKey): Promise<Uint8Array> {
  const res = await fetch('/api/encrypt/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentEncrypted: current ? Buffer.from(current).toString('base64') : null, depositAmount: amount.toString(), ownerPubkey: Buffer.from(owner.toBytes()).toString('base64') }) });
  const data = await res.json();
  return new Uint8Array(Buffer.from(data.encryptedBalance, 'base64'));
}

export async function createDWallet(chain: ChainId, owner: PublicKey): Promise<{ id: Uint8Array; publicKey: string; chain: ChainId; userShareEncrypted: Uint8Array; sessionId: string }> {
  const res = await fetch('/api/ika/dwallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chain, ownerPubkey: owner.toBase58() }) });
  const data = await res.json();
  return { id: new Uint8Array(Buffer.from(data.dwalletId, 'base64')), publicKey: data.publicKey, chain, userShareEncrypted: new Uint8Array(Buffer.from(data.userShareEncrypted, 'base64')), sessionId: data.sessionId };
}
