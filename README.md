# Darkpool

A non-custodial dark pool for private, bridgeless cross-chain block trading on Solana. Price and size are FHE-encrypted before leaving the browser. BTC and ETH collateral is held natively on their home chains — no wrapping, no bridge contracts.

---

## The Problem

Institutional traders and large holders face a structural dilemma when executing block trades:

- **CEX dark pools** require custody — funds leave your control and trust the operator not to front-run you
- **On-chain orderbooks** expose price and size to every observer before a trade settles — inviting MEV and information leakage
- **Cross-chain assets** (BTC, ETH) require wrapping or bridging to participate in DeFi, introducing custodial risk and smart contract attack surface


|                      | CEX Dark Pool | DEX (Uniswap/Jupiter) | Bridges        |
|----------------------|---------------|-----------------------|----------------|
| Private orders       | Yes           | No — front-run        | Yes            |
| Non-custodial        | No (FTX)      | Yes                   | No             |
| Native BTC/ETH       | Yes           | No — wrapped only     | No — bridge risk |
| No counterparty risk | No            | Yes                   | No             |

No venue has all four. Darkpool is the first that does.

There is no venue where a BTC-native holder can trade privately, without bridges, without giving up custody, and without their order being front-run.

---

## What Darkpool Does

Darkpool combines two cryptographic primitives to solve this:

1. **Encrypted orders** — price and size are FHE-encrypted in the browser. No node, including the matching engine, can read your order parameters until a valid match proof is produced at settlement time.

2. **Bridgeless collateral** — BTC and ETH are held via Ika dWallets: distributed MPC keypairs on their native chains. Deposits and withdrawals happen natively with no wrapped tokens and no bridge.

The result is a trading venue where the order book is encrypted, cross-chain assets participate natively, and settlement is provably fair.

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

**Protocol:** Ika dWallet — threshold MPC for native cross-chain asset custody
**Program ID:** `DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq`
**gRPC:** `pre-alpha-dev-1.ika.ika-network.net:443`

When a trader deposits BTC or ETH, Darkpool calls the Ika SDK to provision a **dWallet** — a distributed keypair whose private key shares are held across the Ika MPC network. No single party holds the full key.

```
deposit(chain: "bitcoin", owner: trader_pubkey)
  → Ika creates dWallet → returns dwalletId (32 bytes)
  → dwalletId stored in TraderVault on Solana
  → trader's BTC stays on Bitcoin, controlled by the dWallet
```

On withdrawal, the Darkpool program emits a `WithdrawalRequested` event. Ika nodes watch for this event and collectively sign the destination-chain transaction — moving native BTC or ETH directly to the trader's address. No wrapped token is ever minted.

---

## How Encrypt Is Used

**Protocol:** Encrypt FHE — fully homomorphic encryption for confidential on-chain state
**Program ID:** `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`
**gRPC:** `pre-alpha-dev-1.encrypt.ika-network.net:443`

Before an order leaves the browser, Darkpool calls the Encrypt SDK to produce FHE ciphertexts of the order parameters:

```
encryptOrder({ price, size, orderType }, ownerPublicKey)
  → encryptedPrice  (128-byte FHE ciphertext)
  → encryptedSize   (128-byte FHE ciphertext)
  → orderCommitment (SHA-256 binding price + size + owner + nonce)
```

These ciphertexts are stored directly in the on-chain `Order` account. The matching engine receives two encrypted orders and produces a **match proof** — a 64-byte value computed via FHE operations that proves the orders cross without revealing either value. The Darkpool program verifies this proof on-chain before recording the settlement.

Deposit balances are also encrypted: `encryptedBalance` is stored in each `TraderVault`, so the pool cannot observe individual positions.

---

## Architecture

```
Browser
  └─ encryptOrder() / encryptBalance()    [Encrypt FHE — browser-side]
  └─ createDWallet()                      [Ika — dWallet provisioning]
       │
       ▼
Solana Program (darkpool)
  ├─ PoolState        — global config, fee, pause flag
  ├─ TraderVault      — encrypted balance + dWallet ID per trader
  ├─ Order            — encrypted price + size + commitment
  ├─ Settlement       — settled price, size, maker, taker
  └─ WithdrawRequest  — pending cross-chain withdrawal

Off-chain
  └─ Encrypt MPC relayer  — computes match proofs, calls match_orders
  └─ Ika nodes            — watch WithdrawalRequested, co-sign native txs
```

**Program instructions:**

| Instruction | Signer | Description |
|---|---|---|
| `initialize` | admin | Deploy pool with fee (bps) |
| `deposit` | trader | Register dWallet + encrypted balance |
| `place_order` | trader | Submit FHE-encrypted order |
| `match_orders` | matcher | Settle matched pair with proof |
| `cancel_order` | trader | Cancel an open order |
| `withdraw` | trader | Initiate native withdrawal via Ika |
| `update_fee` | admin | Change protocol fee |
| `set_paused` | admin | Emergency pause/unpause |

---

## Deployed Program IDs

| | Address | Network |
|---|---|---|
| **Darkpool** | `5GmUdA4PCUSGVggTFzFSc2K4n45D8aZ4YoSLTQf2s2x5` | Solana devnet |
| **IDL Account** | `F2wtyT7F3L4vYyDUdfHgxjEdiFzKHx1kXGtfWQLFVs35` | Solana devnet |
| **Pool init tx** | `2hHNvwsJsjYVwYD3enfA578rruTTGaruVxDaE4nSHfMkfqir9Uo39XUYq2Qutdr9RBWYwMtv8u3cz7MwMrw6gU93` | — |
| **Encrypt FHE** | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` | Solana devnet |
| **Ika dWallet** | `DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq` | Solana devnet |

> The Ika and Encrypt gRPC endpoints are pre-alpha. The frontend uses cryptographic local stubs until full Solana devnet integration ships (Q2 2026). All program accounts and instruction interfaces are fully wired — stub replacement requires only updating the API route handlers.

---

## Build

### Prerequisites

| Tool | Version |
|---|---|
| Rust | stable |
| Solana CLI | ≥ 1.18 |
| Anchor CLI | 0.31.x |
| Node.js | ≥ 20 |
| Yarn | any |

```bash
# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm
avm install 0.31.1 && avm use 0.31.1
```

### Build the program

```bash
git clone <repo>
cd darkpool
anchor build
```

Produces:
- `target/deploy/darkpool.so`
- `target/idl/darkpool.json`
- `target/types/darkpool.ts`

---

## Test

Tests run against a local validator that Anchor manages automatically.

```bash
anchor test
```

The suite covers 19 scenarios across the full instruction lifecycle:

- Pool initialization and fee validation
- BTC and ETH collateral deposits (dWallet ID storage)
- Encrypted bid and ask placement
- Order expiry rejection
- MPC match with proof verification
- Duplicate match rejection
- Self-trade prevention
- Invalid proof rejection
- Order cancellation and ownership enforcement
- BTC withdrawal request with native destination address
- Admin pause/unpause with access control
- Fee updates and upper-bound enforcement

---

## Run the Frontend

```bash
# Configure environment
cp .env.example .env
# Set NEXT_PUBLIC_RPC_URL to your Helius devnet API key (free at helius.dev)

cd app
npm install
npm run dev
```

Open `http://localhost:3000`.

**Place Order:**
1. Connect Phantom or Solflare (devnet)
2. Select BID or ASK, asset, price, size, expiry
3. Click Place — price and size are encrypted in the browser before the transaction is signed

**Deposit:**
1. Select BTC or ETH and an amount
2. Click Deposit — an Ika dWallet is provisioned and the `dwalletId` is stored on-chain

**Order Book:** shows live open orders; prices display as `[ENCRYPTED]` because only ciphertexts exist on-chain.

**Settlement Feed:** shows recent matched trades with revealed price and size (disclosed at settlement by the match proof).

### Type check

```bash
cd app
npm run type-check
```

---

## Deploy to Devnet

```bash
solana config set --url devnet
solana airdrop 5
anchor deploy --provider.cluster devnet
```

After deploying, call `initialize(fee_bps)` once as admin to set up the `PoolState` account.

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | Helius devnet RPC URL |
| `NEXT_PUBLIC_PROGRAM_ID` | Darkpool program address |
| `IKA_GRPC_ENDPOINT` | Ika gRPC (leave blank to use local stub) |
| `ENCRYPT_GRPC_ENDPOINT` | Encrypt gRPC (leave blank to use local stub) |
| `ANCHOR_WALLET` | Path to admin keypair |
| `MATCHER_KEYPAIR` | Path to matcher keypair for the relayer |
