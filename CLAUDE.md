# Darkpool — Bridgeless Encrypted Capital Markets on Solana

## Live Protocol Program IDs (Solana devnet)

| Protocol | Program ID | gRPC Endpoint |
|---|---|---|
| **Encrypt FHE** | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` | `pre-alpha-dev-1.encrypt.ika-network.net:443` |
| **Ika dWallet** | `DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq` | `pre-alpha-dev-1.ika.ika-network.net:443` |
| **Darkpool** | `5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5` | — |

A non-custodial dark pool combining Ika (threshold MPC for native cross-chain assets) and Encrypt (FHE confidential state) on Solana.

## Architecture

### On-chain Program (`programs/darkpool/`)
- **`state.rs`** — All account types: `PoolState`, `TraderVault`, `Order`, `Settlement`, `WithdrawRequest`
- **`instructions/`** — One file per instruction: initialize, deposit, place_order, match_orders, cancel_order, withdraw, update_fee, set_paused
- **`error.rs`** — All custom errors

### SDK Layer (`sdk/`)
- **`ika/dwallet.ts`** — Ika dWallet creation + cross-chain transfer initiation
- **`encrypt/fhe.ts`** — FHE order encryption, balance encryption, match proof verification
- **`matching/engine.ts`** — Off-chain MPC matching engine client

### Frontend (`app/`)
- Next.js 15 + Tailwind CSS
- `hooks/useDarkpool.ts` — All program interactions
- `components/OrderForm.tsx` — Encrypted order placement UI
- `components/OrderBook.tsx` — Live order book (metadata only, prices hidden)
- `components/SettlementFeed.tsx` — Recent settlement history

## Key Design Decisions

**Privacy model:** FHE ciphertexts stored on-chain. Price + size encrypted before leaving browser. Only match proof (produced by Encrypt MPC nodes) reveals settled values at settlement time.

**Bridgeless model:** Ika dWallets give traders a distributed keypair for BTC/ETH. No wrapped tokens. Withdrawal triggers a `WithdrawalRequested` event; Ika nodes watch this event and co-sign the destination-chain transaction.

**Match proof binding:** `match_orders` verifies that bytes 0-31 of the proof bind to the maker commitment and bytes 32-63 bind to the taker commitment. Full threshold signature verification is done off-chain by the Encrypt relayer.

**Self-trade prevention:** Hard requirement in `match_orders` — maker and taker must be different signers.

## Local Development

```bash
# Build program
CARGO_NET_OFFLINE=true anchor build

# Run tests (requires local validator)
anchor test

# Start local validator
solana-test-validator

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:
- `NEXT_PUBLIC_RPC_URL` — Helius devnet RPC
- `NEXT_PUBLIC_PROGRAM_ID` — Updated after deploy
- `NEXT_PUBLIC_IKA_ENDPOINT` — Leave empty for devnet stubs (Ika Solana devnet Q2 2026)
- `NEXT_PUBLIC_ENCRYPT_ENDPOINT` — Leave empty for devnet stubs (Encrypt Solana devnet Q2 2026)

## Account Sizes

| Account | Space |
|---|---|
| PoolState | 8 + 75 bytes |
| TraderVault | 8 + 220 bytes |
| Order | 8 + 330 bytes |
| Settlement | 8 + 428 bytes |
| WithdrawRequest | 8 + 147 bytes |

## Instruction Reference

| Instruction | Signer | Purpose |
|---|---|---|
| `initialize` | admin | Deploy pool with fee_bps |
| `deposit` | trader | Deposit + register dWallet |
| `place_order` | trader | Place FHE-encrypted order |
| `match_orders` | matcher (MPC relayer) | Settle matched pair |
| `cancel_order` | trader | Cancel open order |
| `withdraw` | trader | Initiate withdrawal (triggers Ika) |
| `update_fee` | admin | Change protocol fee |
| `set_paused` | admin | Emergency pause/unpause |
