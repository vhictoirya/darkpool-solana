# Darkpool — Build Friction Log

A candid record of every non-trivial roadblock hit during the hackathon build, what caused it, and how it was resolved. Useful for post-mortems, the demo explanation, and anyone picking up this codebase.

---

## 1. Ika 2PC User Share Silently Discarded

**Phase:** Frontend integration  
**Severity:** Critical — the entire withdrawal flow was broken

`createDWallet()` returns two values: `dwalletId` (stored on-chain) and `userShareEncrypted` (the trader's half of the threshold keypair). The initial `deposit()` implementation stored only the `dwalletId` and dropped the user share on the floor:

```ts
// broken
const { dwalletId } = await createDWallet(chain, owner);
```

Without the user share, the Ika nodes can never complete the 2PC signing ceremony — they hold one share, the trader holds the other, and neither can sign alone. A withdrawal would submit the on-chain `WithdrawRequest` and then hang forever waiting for a share that was never saved.

**Fix:** Added `saveDWalletShare(owner, chain, dwallet)` persisting the full `dWallet` object (including `userShareEncrypted`) to `localStorage` keyed by `${owner}:${chain}`. The `withdraw()` flow calls `loadDWalletShare()` to retrieve it before calling `initiateIkaTransfer`.

---

## 2. Withdraw Flow Was Missing the Ika Signing Step Entirely

**Phase:** Frontend integration  
**Severity:** Critical — withdrawals only emitted an on-chain event; no cross-chain tx was ever initiated

The original `withdraw()` in `useDarkpool.ts` called the Solana `withdraw` instruction (which creates a `WithdrawRequest` account) and then returned. That's only Phase 1 of the two-phase withdrawal. The `initiateTransfer` call to the Ika network — which actually moves the native BTC/ETH — was never wired up.

**Fix:** Extended `withdraw()` to:
1. Call `fetchWithdrawProof()` — reads the `WithdrawRequest` account and serialises it as the Solana-finality proof that Ika nodes require
2. Call `initiateIkaTransfer(dwalletId, userShare, destination, proof)` — submits the proof + user share to the Ika MPC network, triggering the threshold signature on the destination chain
3. Poll `pollIkaTransferStatus()` and surface the resulting tx hash in the UI via `ikaStatus`

---

## 3. `match_orders` Accepted Any Signer — No Authority Enforcement

**Phase:** On-chain program  
**Severity:** Critical — any keypair could settle trades at any price

The `match_orders` instruction had no check on who was calling it. The Encrypt MPC relayer is supposed to be the only entity authorised to settle trades, but there was nothing preventing an arbitrary wallet from submitting a crafted proof.

**Fix:** Added `encrypt_mpc_authority: Pubkey` to `PoolState` (set at `initialize` time). `match_orders` now requires:

```rust
require!(
    ctx.accounts.matcher.key() == pool.encrypt_mpc_authority,
    DarkpoolError::Unauthorized
);
```

The authority is the aggregated Encrypt MPC public key. Upgrading to a CPI-based check when Encrypt ships its full on-chain program requires no instruction changes — only the authority registration.

---

## 4. Match Proof Was Structurally Trivial — Price Forgery Possible

**Phase:** On-chain program  
**Severity:** High — a malicious relayer could claim any settlement price

The original proof verification checked:

```rust
require!(match_proof[0..32] == maker_order.order_commitment, ...);
require!(match_proof[32..64] == taker_order.order_commitment, ...);
```

This only proved the orders existed; it said nothing about the `settled_price` and `settled_size` arguments also passed to the instruction. A rogue caller could pass the correct commitment bytes but inflate the price — the on-chain check would pass.

**Fix:** Changed `match_proof[0..32]` from a raw commitment copy to a SHA-256 hash that commits to the full settlement tuple:

```rust
let hash = hashv(&[
    &maker_order.order_commitment,
    &taker_order.order_commitment,
    &settled_price.to_le_bytes(),
    &settled_size.to_le_bytes(),
]);
require!(match_proof[0..32] == hash.to_bytes(), DarkpoolError::InvalidMatchProof);
```

Uses Solana's native `hashv` syscall (no extra compute budget). The SDK matching engine was updated in parallel to compute the same hash before submitting.

---

## 5. gRPC Incompatible with Next.js Edge Runtime

**Phase:** Deployment / API routes  
**Severity:** Medium — all four API routes would silently break on Vercel

The Next.js default runtime for API routes is the Edge Runtime, which strips Node.js built-ins (`net`, `tls`, `http2`) that gRPC requires. The routes compiled fine locally but would fail on any Vercel deployment with a cryptic module-not-found error at cold start.

**Fix:** Added `export const runtime = "nodejs"` to all four API routes:
- `/api/ika/dwallet/route.ts`
- `/api/ika/transfer/route.ts`
- `/api/encrypt/order/route.ts`
- `/api/encrypt/balance/route.ts`

---

## 6. `WalletMultiButton` Hydration Mismatch

**Phase:** Frontend  
**Severity:** Medium — React hydration error on every page load, visible in browser console

The `@solana/wallet-adapter-react-ui` `WalletMultiButton` renders wallet-connection state (connected wallet icon vs. "Select Wallet" text) that is only available client-side. Importing it directly caused the server-rendered HTML to differ from the client's first render.

React error:
```
Hydration failed because the server rendered HTML didn't match the client.
+  <i className="wallet-adapter-button-start-icon">
-  Select Wallet
```

**Fix:** Changed from a static import to a dynamic import with `ssr: false`:

```ts
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);
```

---

## 7. Wallet Gate Was Dead Code — `if (false)`

**Phase:** Frontend  
**Severity:** Medium — order form was always rendered even when no wallet connected

`OrderForm.tsx` had a guard that was supposed to block rendering until a wallet was connected. The condition was `if (false)` — always skipped, always rendered. Any user could interact with the form without a wallet, producing confusing downstream errors.

**Fix:** Changed to `if (!connected)`.

---

## 8. API Route Import Paths Wrong Depth

**Phase:** Frontend  
**Severity:** Medium — TypeScript compilation errors on the API routes

The `encrypt/order` and `encrypt/balance` routes imported from `../../../../../../lib/...` (7 levels up) when the correct relative path is 6 levels. The error only appeared at type-check time, not at runtime on Node.js (because Node resolves the real path anyway), which masked it during local dev.

**Fix:** Recalculated using `python3 -c "import os; print(os.path.relpath(...))"` and corrected all import depths.

---

## 9. `Asset` Type Not Assignable to `ChainId`

**Phase:** Frontend — TypeScript  
**Severity:** Low — type error blocked compilation

`deposit(amount, asset)` was called with `"btc"` directly, but the Ika SDK's `createDWallet` expected a `ChainId` of `"bitcoin"`. The UI asset selector uses short codes (`btc`, `eth`, `sol`) that don't match chain IDs.

**Fix:** Added a mapping constant:

```ts
const ASSET_TO_CHAIN: Record<Asset, ChainId> = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", usdc: "solana"
};
```

---

## 10. CSS Module Import TypeScript Error

**Phase:** Frontend — TypeScript  
**Severity:** Low — `globals.css` import flagged as module with no type declarations

Next.js projects with `strict: true` in `tsconfig.json` need explicit type declarations for non-JS imports. The `globals.css` import in `layout.tsx` produced a TS error because no `.d.ts` covered CSS modules.

**Fix:** Created `app/src/declarations.d.ts`:

```ts
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
```

---

## 11. SDK TypeScript Files Not Visible to App's `tsconfig`

**Phase:** Frontend — TypeScript  
**Severity:** Low — type errors in SDK imports not caught during `npm run type-check`

The `app/tsconfig.json` `include` array only covered `src/**`. SDK files live at `../../sdk/`. Type errors in SDK-imported functions were invisible to the app's type checker.

**Fix:** Added `"../../sdk/**/*.ts"` to the `include` array in `app/tsconfig.json`.

---

## 12. Matching Engine Missing SHA-256 Proof Computation

**Phase:** SDK  
**Severity:** High — engine would submit structurally invalid proofs after the on-chain change

When `match_orders` was upgraded to verify a SHA-256 hash, the SDK matching engine (`engine.ts`) still built proofs using the old layout (raw commitment bytes at offset 0). It would have submitted proofs that the new on-chain check rejected every time.

**Fix:** Added `import { createHash } from "crypto"` and a `buildMatchProof()` helper to `engine.ts` that computes the same `SHA-256(maker ∥ taker ∥ price_le8 ∥ size_le8)` hash and places it at `proof[0..32]`.

---

## 13. Dev Server Port Conflict (3000 vs 3001)

**Phase:** Local development  
**Severity:** Low — confusing but easy to fix

The default Next.js dev port (3000) was already in use by another process on the dev machine. Starting `npm run dev` silently failed with `EADDRINUSE`.

**Fix:** Set `"dev": "next dev --port 3001"` in `app/package.json`. Frontend is now consistently at `http://localhost:3001`.

---

## Protocol Availability Notes

Both Ika and Encrypt are pre-alpha. Their Solana devnet gRPC endpoints (`pre-alpha-dev-1.{ika,encrypt}.ika-network.net:443`) were intermittently reachable during the build. All four API routes implement a gRPC-first, local-stub-fallback pattern so the full product flow remains testable regardless of endpoint availability. The stubs return cryptographically-structured responses (correct byte lengths, valid-format commitments) rather than empty mocks, so the on-chain program's proof verification exercises the real code path.
