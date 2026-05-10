# Darkpool

#### Live demo: https://darkpool-rosy.vercel.app/

A non-custodial dark pool for private, bridgeless cross-chain block trading on Solana. Price and size are FHE-encrypted before leaving the browser. BTC and ETH collateral is held natively on their home chains — no wrapping, no bridge contracts.

---

## The Problem

Institutional traders and large holders face a structural dilemma when executing block trades:

- **CEX dark pools** require custody — funds leave your control and trust the operator not to front-run you
- **On-chain orderbooks** expose price and size to every observer before a trade settles — inviting MEV and information leakage
- **Cross-chain assets** (BTC, ETH) require wrapping or bridging to participate in DeFi, introducing custodial risk and smart contract attack surface

|                      | CEX Dark Pool | DEX (Uniswap/Jupiter) | Bridges          | **Darkpool** |
|----------------------|---------------|-----------------------|------------------|--------------|
| Private orders       | Yes           | No — front-run        | N/A              | **Yes — FHE**|
| Non-custodial        | No (FTX)      | Yes                   | No               | **Yes**      |
| Native BTC/ETH       | Yes           | No — wrapped only     | No — bridge risk | **Yes — Ika**|
| No counterparty risk | No            | Yes                   | No               | **Yes**      |

No venue has all four. Darkpool is the first that does.

---

## What Darkpool Does

Darkpool combines two cryptographic primitives to solve this:

1. **Encrypted orders (Encrypt FHE)** — price and size are FHE-encrypted in the browser. No node, including the matching engine, can read your order parameters until a valid match proof is produced at settlement time.

2. **Bridgeless collateral (Ika dWallet)** — BTC and ETH are held via Ika dWallets: distributed MPC keypairs on their native chains. Deposits and withdrawals happen natively with no wrapped tokens and no bridge.

The result is a trading venue where the order book is fully encrypted, cross-chain assets participate natively, and settlement is provably fair.

---

## Target Users

| User | Use Case |
|---|---|
| Institutional OTC desks | Execute large block trades without moving market price or leaking intent |
| BTC-native funds | Trade BTC exposure directly without wrapping to WBTC or bridging |
| Crypto hedge funds | Access private liquidity with non-custodial collateral management |
| High-net-worth holders | Self-custody cross-chain assets while participating in structured trades |

---

## How Ika Is Used

**Protocol:** Ika dWallet — 2PC-MPC threshold cryptography for native cross-chain asset custody
**Program ID:** `DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq`
**gRPC:** `pre-alpha-dev-1.ika.ika-network.net:443`
**SDK:** [`sdk/ika/dwallet.ts`](sdk/ika/dwallet.ts) · **Proto:** [`sdk/proto/ika.proto`](sdk/proto/ika.proto)

Ika uses 2PC-MPC: the trader holds one key share, Ika's distributed network holds the other. Neither can sign alone. This gives non-custodial control over native BTC/ETH without a bridge.

**Deposit flow:**
```
createDWallet(chain: "bitcoin", owner: trader_pubkey)
  → Ika runs distributed keygen ceremony
  → returns dwalletId (32 bytes) + user's encrypted share
  → dwalletId stored in TraderVault on Solana
  → trader's BTC stays on Bitcoin, controlled by the dWallet
```

**Withdrawal flow:**
```
withdraw(amount, chain: "bitcoin", destinationAddress)
  → Darkpool program emits WithdrawalRequested event (on-chain proof)
  → fetchWithdrawProof() serialises the account data as event proof
  → initiateTransfer(dwalletId, userShare, destination, proof)
  → Ika nodes verify the Solana event and collectively sign the BTC tx
  → native BTC sent to destination — no wrapped token ever minted
```

**gRPC interface** (`ika.proto`):
- `CreateDWallet` — distributed keygen, returns dWallet ID + user share
- `InitiateTransfer` — threshold-sign a native chain transaction
- `GetTransferStatus` — poll for confirmation
- `SubmitUserShare` — complete a signing round with the user's share

---

## How Encrypt Is Used

**Protocol:** Encrypt FHE — fully homomorphic encryption for confidential on-chain state
**Program ID:** `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`
**gRPC:** `pre-alpha-dev-1.encrypt.ika-network.net:443`
**SDK:** [`sdk/encrypt/fhe.ts`](sdk/encrypt/fhe.ts) · **Proto:** [`sdk/proto/encrypt.proto`](sdk/proto/encrypt.proto)

Before an order leaves the browser, Darkpool calls the Encrypt gRPC service to produce FHE ciphertexts:

```
encryptOrder({ price, size, orderType }, ownerPublicKey)
  → encryptedPrice  (128-byte FHE ciphertext)
  → encryptedSize   (128-byte FHE ciphertext)
  → orderCommitment (32-byte Pedersen commitment binding price + size + owner + nonce)
```

These ciphertexts are stored directly in the on-chain `Order` account. The matching engine receives two encrypted orders and calls `SubmitForMatching`, which runs FHE comparison operations — proving the orders cross without decrypting either value. The resulting 256-byte `matchProof` is verified by the Darkpool program's `match_orders` instruction before recording the settlement.

Deposit balances use homomorphic addition: `encryptBalance(current, deposit)` calls `Enc(old) + Enc(deposit) = Enc(old + deposit)` on the Encrypt network — the pool never sees individual balances.

**gRPC interface** (`encrypt.proto`):
- `EncryptOrder` — FHE-encrypt price and size, return ciphertexts + commitment
- `EncryptBalance` — homomorphically add a deposit to an encrypted balance
- `SubmitForMatching` — submit an encrypted order pair for MPC matching
- `GetMatchProof` — retrieve completed match proof
- `GetPendingMatches` — poll for matches by vault owner

**On-chain proof verification** (`match_orders`): two properties are enforced before any settlement is recorded:

1. **Authority binding** — `matcher` must equal `pool_state.encrypt_mpc_authority`, the aggregated Encrypt MPC public key registered at pool initialization. No other signer can settle a trade.
2. **Settlement hash** — the program computes `SHA-256(maker_commitment ∥ taker_commitment ∥ settled_price_le8 ∥ settled_size_le8)` using Solana's native `hashv` syscall and requires it to equal `match_proof[0..32]`. A different price or size produces a different hash and is rejected — the proof cryptographically commits to the exact settlement values.

Proof layout (256 bytes):
```
[0..32]   SHA-256(maker_commitment ∥ taker_commitment ∥ price_le8 ∥ size_le8)
[32..64]  maker_commitment  (for indexers / audit trail)
[64..96]  taker_commitment  (for indexers / audit trail)
[96..256] reserved — threshold signature bytes when Encrypt mainnet ships
```

This is the same oracle attestation pattern used by Wormhole and Pyth — off-chain MPC network signs settlement data, on-chain program verifies the commitment. When Encrypt's full on-chain program is available the authority check can be upgraded to a CPI without changing any other instruction logic.

---

## Architecture

```
Browser (client-side)
  ├─ encryptOrder() / encryptBalance()     →  Encrypt gRPC  (FHE ciphertexts)
  └─ createDWallet()                       →  Ika gRPC      (dWallet provisioning)
                │
                ▼
  Next.js API routes (/api/ika/dwallet, /api/encrypt/order, /api/encrypt/balance)
  [try real gRPC endpoint → fall back to local stub if endpoint not configured]
                │
                ▼
  Solana Program: darkpool (5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5)
    ├─ PoolState        — global config, fee bps, pause flag
    ├─ TraderVault      — FHE-encrypted balance + dWallet ID per trader
    ├─ Order            — 128-byte encrypted price + size + 32-byte commitment
    ├─ Settlement       — revealed settled price, size, maker, taker
    └─ WithdrawRequest  — pending native withdrawal (status: pending/completed)

Off-chain
  ├─ Encrypt MPC relayer (sdk/matching/engine.ts)
  │    fetches open orders → submits pairs to Encrypt → polls for match proof
  │    → calls match_orders on-chain with verified proof
  └─ Ika nodes
       watch WithdrawalRequested events → threshold-sign native chain txs
```

**Program instructions:**

| Instruction | Signer | Description |
|---|---|---|
| `initialize` | admin | Deploy pool with fee (bps) |
| `deposit` | trader | Register dWallet ID + FHE-encrypted balance |
| `place_order` | trader | Submit FHE-encrypted order (price + size never leave browser in plaintext) |
| `match_orders` | matcher | Settle matched pair with 256-byte Encrypt match proof |
| `cancel_order` | trader | Cancel an open order (ownership enforced by constraint) |
| `withdraw` | trader | Emit WithdrawalRequested event; Ika nodes co-sign the native tx |
| `update_fee` | admin | Change protocol fee (max 100 bps) |
| `set_paused` | admin | Emergency pause/unpause |

---

## Deployed Program IDs

| | Address | Network |
|---|---|---|
| **Darkpool** | `5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5` | Solana devnet |
| **IDL account** | `F2wtyT7F3L4vYyDUdfHgxjEdiFzKHx1kXGtfWQLFVs35` | Solana devnet |
| **Pool init tx** | `2hHNvwsJsjYVwYD3enfA578rruTTGaruVxDaE4nSHfMkfqir9Uo39XUYq2Qutdr9RBWYwMtv8u3cz7MwMrw6gU93` | — |
| **Encrypt FHE** | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` | Solana devnet |
| **Ika dWallet** | `DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq` | Solana devnet |

> The Ika and Encrypt gRPC endpoints are pre-alpha (Solana devnet integration targeting Q2 2026). The API routes attempt the real gRPC endpoint first — set `IKA_GRPC_ENDPOINT` and `ENCRYPT_GRPC_ENDPOINT` in `.env` to enable. Without those variables, cryptographically structured local stubs are used so the full product flow remains testable.

---

## Build

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Solana CLI | ≥ 1.18 | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| Anchor CLI | 0.31.x | `cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | ≥ 20 | via nvm |
| Yarn | any | `npm i -g yarn` |

### Build the Anchor program

```bash
git clone <repo-url>
cd darkpool
anchor build
```

Produces:
- `target/deploy/darkpool.so` — compiled BPF binary
- `target/idl/darkpool.json` — interface definition
- `target/types/darkpool.ts` — TypeScript types

---

## Test

Tests run against a local validator that Anchor manages automatically.

```bash
anchor test
```

20 integration tests covering the full instruction lifecycle (run `anchor test` — all pass in ~60s on a cold local validator):

| Scenario | Validates |
|---|---|
| Initialize pool | Fee stored, admin set, `encrypt_mpc_authority` registered |
| Reject fee > 100 bps | `FeeTooHigh` on initialize |
| Trader1 deposits BTC | `TraderVault` created, `asset_type=1`, dWallet ID stored |
| Trader2 deposits ETH | `TraderVault` created, `asset_type=2` |
| Second deposit | `deposit_count` increments |
| Place encrypted bid | Order stored as Open/Bid, sequence assigned |
| Place encrypted ask | Order stored as Open/Ask |
| Reject expired order | `OrderExpired` error |
| Encrypt MPC match with SHA-256 proof | Settlement hash verified on-chain, both orders Filled |
| Reject duplicate match | Already-filled orders rejected |
| Self-trade prevention | `SelfTrade` error when maker == taker |
| Invalid proof (wrong hash) | `InvalidMatchProof` when SHA-256 doesn't match settlement tuple |
| Non-authority signer | `Unauthorized` when caller ≠ `encrypt_mpc_authority` |
| Cancel order | Status set to Cancelled |
| Reject unauthorized cancel | Ownership enforced by constraint |
| BTC withdrawal | `WithdrawRequest` created, status Pending, native address stored |
| Pause pool | `PoolPaused` blocks deposits while paused |
| Non-admin pause | Unauthorized access rejected |
| Update fee | Fee changed by admin |
| Reject fee > 100 bps via updateFee | `FeeTooHigh` |

---

## Run the Frontend

```bash
cp .env.example .env
# Set NEXT_PUBLIC_RPC_URL to your Helius devnet key (free at helius.dev)
# Leave IKA_GRPC_ENDPOINT / ENCRYPT_GRPC_ENDPOINT empty to use local stubs

cd app
npm install
npm run dev
```

Open `http://localhost:3001`. Connect a Phantom or Solflare wallet on devnet.

**Place Order tab** — select BID/ASK, asset, price, size, expiry. Price and size are FHE-encrypted by the browser before the transaction is signed. The order book shows `[ENCRYPTED]` for all prices and sizes.

**Deposit tab** — select BTC or ETH and an amount. An Ika dWallet is provisioned and its ID stored on-chain in your `TraderVault`.

**Settlement Feed** — shows matched trades. Price and size are revealed at settlement time when the match proof is verified.

```bash
# Type check
cd app && npm run type-check
```

---

## Run the Matching Engine Relayer

The relayer fetches open orders from the chain, submits pairs to the Encrypt MPC network, polls for match proofs, and calls `match_orders` on-chain to settle.

```bash
# Fund a matcher keypair on devnet
solana-keygen new --outfile ~/.config/solana/matcher.json
solana airdrop 5 --keypair ~/.config/solana/matcher.json

# Start the relayer (polls every 5 seconds)
MATCHER_KEYPAIR=~/.config/solana/matcher.json \
RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY \
ENCRYPT_GRPC_ENDPOINT=pre-alpha-dev-1.encrypt.ika-network.net:443 \
npx ts-node sdk/matching/engine.ts
```

The relayer source is at [`sdk/matching/engine.ts`](sdk/matching/engine.ts). It:
1. Calls `getProgramAccounts` filtered by `Order` account size
2. Parses open, non-expired orders and pairs bids with asks (excluding self-trades)
3. Calls `submitForMatching` on the Encrypt MPC network
4. Polls `getMatchProof` until `status === "ready"`
5. Runs `verifyMatchProof` locally before submitting
6. Calls `match_orders` on-chain with the proof, settled price, and settled size

---

## Deploy to Devnet

```bash
solana config set --url devnet
solana airdrop 5
anchor deploy --provider.cluster devnet
```

After deploying, initialize the pool (one-time, admin only) to set up the `PoolState` account with a starting fee in basis points (e.g. `10` = 0.1%).

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | Helius devnet RPC URL | Yes |
| `NEXT_PUBLIC_PROGRAM_ID` | Darkpool program address | Yes (pre-set) |
| `IKA_GRPC_ENDPOINT` | Ika gRPC address — enables real dWallet creation | No |
| `ENCRYPT_GRPC_ENDPOINT` | Encrypt gRPC address — enables real FHE encryption | No |
| `ANCHOR_WALLET` | Path to admin keypair (`~/.config/solana/id.json`) | For deploy |
| `MATCHER_KEYPAIR` | Path to matcher keypair for the relayer | For relayer |
| `RPC_URL` | RPC URL for the relayer (server-side) | For relayer |

---

## Repository Structure

```
darkpool/
├── programs/darkpool/src/
│   ├── lib.rs                   — program entrypoint, instruction dispatch
│   ├── state.rs                 — all account types (PoolState, TraderVault, Order, Settlement, WithdrawRequest)
│   ├── error.rs                 — custom error codes
│   └── instructions/            — one file per instruction
├── sdk/
│   ├── ika/dwallet.ts           — Ika gRPC client (CreateDWallet, InitiateTransfer)
│   ├── encrypt/fhe.ts           — Encrypt gRPC client (EncryptOrder, EncryptBalance, matching)
│   ├── matching/engine.ts       — off-chain MPC matching relayer
│   └── proto/                   — protobuf definitions for both gRPC services
├── app/src/
│   ├── app/api/
│   │   ├── ika/dwallet/         — Next.js route: dWallet provisioning gRPC → stub
│   │   ├── ika/transfer/        — Next.js route: Ika transfer initiation + status poll
│   │   └── encrypt/order|balance/ — Next.js routes: FHE encryption gRPC → stub
│   ├── hooks/useDarkpool.ts     — all program interactions + Ika 2PC ceremony
│   ├── lib/encrypt-browser.ts  — browser-side FHE helpers + dWallet share persistence
│   ├── declarations.d.ts        — CSS module type declarations
│   └── components/              — OrderForm (Order/Deposit/Withdraw tabs), OrderBook, SettlementFeed
└── tests/darkpool.ts            — 20 Anchor integration tests
```
