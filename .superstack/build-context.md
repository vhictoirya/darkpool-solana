# Build Context: Darkpool

## Stack

```json
{
  "stack": {
    "program_language": "Rust + Anchor 0.31.0",
    "frontend": "Next.js 15 + Tailwind CSS",
    "wallet": "Wallet Standard (Phantom, Solflare)",
    "rpc": "Helius devnet",
    "sdk_ika": "sdk/ika/dwallet.ts (stubs until Ika Solana devnet Q2 2026)",
    "sdk_encrypt": "sdk/encrypt/fhe.ts (stubs until Encrypt Solana devnet Q2 2026)",
    "sdk_matching": "sdk/matching/engine.ts (devnet simulation)",
    "test_framework": "Anchor test + Mocha + Chai"
  },
  "architecture": "Pattern 1 (Next.js + Anchor) with custom SDK layer",
  "build_status": {
    "mvp_complete": true,
    "program_compiled": true,
    "tests_passing": false,
    "devnet_deployed": false,
    "ika_integrated": false,
    "encrypt_integrated": false
  }
}
```

## What's Built

### Program Instructions (all compiling)
- `initialize` — Deploy pool with fee_bps
- `deposit` — Encrypted collateral deposit + Ika dWallet registration  
- `place_order` — FHE-encrypted bid/ask placement
- `match_orders` — MPC engine settlement with proof verification
- `cancel_order` — Cancel open order
- `withdraw` — Trigger Ika cross-chain withdrawal
- `update_fee` / `set_paused` — Admin controls

### SDK Layer
- `sdk/ika/dwallet.ts` — dWallet create + transfer (live endpoint + devnet stub)
- `sdk/encrypt/fhe.ts` — Order encryption, balance encryption, proof verification
- `sdk/matching/engine.ts` — Off-chain MPC matching client + devnet simulator

### Frontend
- `app/src/app/page.tsx` — Main trading interface
- `app/src/components/OrderForm.tsx` — Encrypted order placement
- `app/src/components/OrderBook.tsx` — Live order book (metadata only)
- `app/src/components/SettlementFeed.tsx` — Settlement history

## Next Steps to Production

1. `anchor test` — run full test suite against local validator
2. `anchor deploy --provider.cluster devnet` — deploy to Solana devnet
3. Register for Ika Solana devnet early access (Q2 2026)
4. Register for Encrypt Solana devnet early access (Q2 2026)
5. Replace SDK stubs with live endpoints
6. Run matching engine as a persistent relayer service
7. Security audit before mainnet
