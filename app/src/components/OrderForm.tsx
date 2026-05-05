"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDarkpool, type ChainId } from "../hooks/useDarkpool";

type Side = "bid" | "ask";
type Asset = "btc" | "eth" | "sol" | "usdc";

const ASSETS: { id: Asset; label: string; ticker: string }[] = [
  { id: "btc", label: "Bitcoin", ticker: "BTC/USDC" },
  { id: "eth", label: "Ethereum", ticker: "ETH/USDC" },
  { id: "sol", label: "Solana", ticker: "SOL/USDC" },
  { id: "usdc", label: "USDC", ticker: "USDC" },
];

const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "4 hours", seconds: 14400 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

const ASSET_TO_CHAIN: Record<Asset, ChainId> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  usdc: "solana",
};

export default function OrderForm() {
  const { placeOrder, deposit, withdraw, loading, error, ikaStatus } = useDarkpool();
  const { publicKey, connected } = useWallet();

  const [tab, setTab] = useState<"order" | "deposit" | "withdraw">("order");
  const [side, setSide] = useState<Side>("bid");
  const [asset, setAsset] = useState<Asset>("btc");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [expiry, setExpiry] = useState(3600);

  const [depositAmt, setDepositAmt] = useState("");
  const [depositAsset, setDepositAsset] = useState<Asset>("btc");
  const [dwalletAddress, setDwalletAddress] = useState<string | null>(null);

  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState<Asset>("btc");
  const [withdrawDest, setWithdrawDest] = useState("");
  const [ikaTransferTx, setIkaTransferTx] = useState<string | null>(null);

  const [lastTx, setLastTx] = useState<string | null>(null);

  const panelStyle = {
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
  };

  const inputStyle = {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: "13px",
    padding: "7px 10px",
    width: "100%",
    outline: "none",
  };

  const labelStyle = {
    fontSize: "9px",
    color: "var(--text-faint)",
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    display: "block",
    marginBottom: "4px",
  };

  if (!connected) {
    return (
      <div style={{ ...panelStyle, padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontSize: "28px", marginBottom: "12px", opacity: 0.3 }}>⬡</div>
        <div style={{ color: "var(--text-dim)", fontSize: "11px", letterSpacing: "0.1em", marginBottom: "6px" }}>
          CONNECT WALLET TO TRADE
        </div>
        <div style={{ color: "var(--text-faint)", fontSize: "9px" }}>
          Phantom · Solflare · Devnet
        </div>
      </div>
    );
  }

  const handleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = BigInt(Math.round(parseFloat(price) * 1e6));
    const s = BigInt(Math.round(parseFloat(size) * 1e6));
    const result = await placeOrder({ price: p, size: s, orderType: side === "bid" ? "bid" : "ask" }, expiry);
    if (result) setLastTx(result.signature);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = BigInt(Math.round(parseFloat(depositAmt) * 1e8));
    const result = await deposit(amt, ASSET_TO_CHAIN[depositAsset]);
    if (result) {
      setLastTx(result.signature);
      setDwalletAddress(result.dwalletPublicKey);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = BigInt(Math.round(parseFloat(withdrawAmt) * 1e8));
    const result = await withdraw(amt, ASSET_TO_CHAIN[withdrawAsset], withdrawDest);
    if (result) {
      setLastTx(result.signature);
      if (result.ikaTransfer) setIkaTransferTx(result.ikaTransfer.txHash);
    }
  };

  return (
    <div style={panelStyle}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {(["order", "deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "9px",
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              background: "transparent",
              borderBottom: tab === t ? "2px solid var(--amber)" : "2px solid transparent",
              color: tab === t ? "var(--amber)" : "var(--text-faint)",
              marginBottom: "-1px",
              cursor: "pointer",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {t === "order" ? "Place Order" : t === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>

      <div style={{ padding: "16px" }}>

        {/* ── ORDER TAB ──────────────────────────────────────────────────────── */}
        {tab === "order" && (
          <form onSubmit={handleOrder} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            <div style={{ display: "flex", gap: "0" }}>
              <button type="button" onClick={() => setSide("bid")} style={{ flex: 1, padding: "8px", fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", background: side === "bid" ? "var(--green-dim)" : "var(--bg)", color: side === "bid" ? "var(--green)" : "var(--text-faint)", border: `1px solid ${side === "bid" ? "var(--green)" : "var(--border)"}`, borderRight: "none" }}>
                ▲ BUY / BID
              </button>
              <button type="button" onClick={() => setSide("ask")} style={{ flex: 1, padding: "8px", fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", background: side === "ask" ? "var(--red-dim)" : "var(--bg)", color: side === "ask" ? "var(--red)" : "var(--text-faint)", border: `1px solid ${side === "ask" ? "var(--red)" : "var(--border)"}` }}>
                ▼ SELL / ASK
              </button>
            </div>

            <div>
              <label style={labelStyle}>Asset</label>
              <select value={asset} onChange={(e) => setAsset(e.target.value as Asset)} style={inputStyle}>
                {ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.ticker})</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>
                Price (USDC)
                <span style={{ marginLeft: "6px", color: "var(--violet)", fontSize: "8px" }}>— FHE ENCRYPTED</span>
              </label>
              <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" required style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>
                Size
                <span style={{ marginLeft: "6px", color: "var(--violet)", fontSize: "8px" }}>— FHE ENCRYPTED</span>
              </label>
              <input type="number" min="0" step="any" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.00" required style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Order Expiry</label>
              <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} style={inputStyle}>
                {EXPIRY_OPTIONS.map((o) => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
              </select>
            </div>

            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", fontSize: "9px", color: "var(--text-faint)", letterSpacing: "0.05em" }}>
              <span style={{ color: "var(--violet)" }}>⬡ ENCRYPT FHE</span>
              {" "}price and size are encrypted before leaving your browser.
              No node — including the matching engine — can read them.
            </div>

            <button type="submit" disabled={loading || !price || !size} style={{ padding: "10px", fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'IBM Plex Mono', monospace", cursor: loading ? "wait" : "pointer", background: side === "bid" ? (loading ? "var(--green-dim)" : "var(--green)") : (loading ? "var(--red-dim)" : "var(--red)"), color: "#000", border: "none", fontWeight: 600, opacity: (!price || !size) ? 0.4 : 1 }}>
              {loading ? "SUBMITTING…" : `PLACE ${side === "bid" ? "BID" : "ASK"}`}
            </button>
          </form>
        )}

        {/* ── DEPOSIT TAB ────────────────────────────────────────────────────── */}
        {tab === "deposit" && (
          <form onSubmit={handleDeposit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={labelStyle}>Asset</label>
              <select value={depositAsset} onChange={(e) => setDepositAsset(e.target.value as Asset)} style={inputStyle}>
                {ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Amount</label>
              <input type="number" min="0" step="any" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="0.00" required style={inputStyle} />
            </div>

            {(depositAsset === "btc" || depositAsset === "eth") && (
              <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", fontSize: "9px", color: "var(--text-faint)" }}>
                <span style={{ color: "var(--amber)" }}>⬡ IKA dWALLET</span>
                {" "}A 2PC-MPC dWallet will be created. Your {depositAsset.toUpperCase()} stays
                on {depositAsset === "btc" ? "Bitcoin" : "Ethereum"} — no wrapping, no bridge.
                Your key share is saved locally for withdrawal signing.
              </div>
            )}

            {/* dWallet address returned from the last deposit */}
            {dwalletAddress && (
              <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--amber)", fontSize: "9px" }}>
                <div style={{ color: "var(--amber)", letterSpacing: "0.1em", marginBottom: "4px" }}>
                  ⬡ DWALLET ADDRESS
                </div>
                <div style={{ color: "var(--text-dim)", wordBreak: "break-all", fontFamily: "monospace", fontSize: "10px" }}>
                  {dwalletAddress}
                </div>
                <div style={{ color: "var(--text-faint)", marginTop: "4px" }}>
                  Send {depositAsset.toUpperCase()} to this address to fund your position.
                </div>
              </div>
            )}

            <button type="submit" disabled={loading || !depositAmt} style={{ padding: "10px", fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'IBM Plex Mono', monospace", cursor: loading ? "wait" : "pointer", background: loading ? "var(--amber-dim)" : "var(--amber)", color: "#000", border: "none", fontWeight: 600, opacity: !depositAmt ? 0.4 : 1 }}>
              {loading
                ? (ikaStatus ?? "DEPOSITING…")
                : "DEPOSIT"}
            </button>
          </form>
        )}

        {/* ── WITHDRAW TAB ───────────────────────────────────────────────────── */}
        {tab === "withdraw" && (
          <form onSubmit={handleWithdraw} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={labelStyle}>Asset</label>
              <select value={withdrawAsset} onChange={(e) => setWithdrawAsset(e.target.value as Asset)} style={inputStyle}>
                {ASSETS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Amount</label>
              <input type="number" min="0" step="any" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="0.00" required style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>
                Destination Address
                <span style={{ marginLeft: "6px", color: "var(--amber)", fontSize: "8px" }}>
                  {withdrawAsset === "btc" ? "— BITCOIN" : withdrawAsset === "eth" ? "— ETHEREUM" : "— SOLANA"}
                </span>
              </label>
              <input
                type="text"
                value={withdrawDest}
                onChange={(e) => setWithdrawDest(e.target.value)}
                placeholder={withdrawAsset === "btc" ? "bc1q…" : withdrawAsset === "eth" ? "0x…" : "pubkey…"}
                required
                style={{ ...inputStyle, fontSize: "11px" }}
              />
            </div>

            {(withdrawAsset === "btc" || withdrawAsset === "eth") && (
              <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", fontSize: "9px", color: "var(--text-faint)" }}>
                <span style={{ color: "var(--amber)" }}>⬡ IKA 2PC SIGNING</span>
                {" "}The on-chain withdrawal request is verified by Ika nodes against
                Solana finality. Your saved key share completes the threshold signature.
                Native {withdrawAsset.toUpperCase()} is sent directly — no bridge.
              </div>
            )}

            {ikaTransferTx && (
              <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--amber)", fontSize: "9px" }}>
                <div style={{ color: "var(--amber)", marginBottom: "4px" }}>⬡ IKA TRANSFER SUBMITTED</div>
                <div style={{ color: "var(--text-dim)", wordBreak: "break-all", fontFamily: "monospace" }}>
                  {ikaTransferTx}
                </div>
              </div>
            )}

            <button type="submit" disabled={loading || !withdrawAmt || !withdrawDest} style={{ padding: "10px", fontSize: "11px", letterSpacing: "0.12em", fontFamily: "'IBM Plex Mono', monospace", cursor: loading ? "wait" : "pointer", background: loading ? "var(--amber-dim)" : "var(--amber)", color: "#000", border: "none", fontWeight: 600, opacity: (!withdrawAmt || !withdrawDest) ? 0.4 : 1 }}>
              {loading
                ? (ikaStatus ?? "WITHDRAWING…")
                : "WITHDRAW"}
            </button>
          </form>
        )}

        {/* ── Status messages ─────────────────────────────────────────────────── */}
        {error && (
          <div style={{ marginTop: "12px", padding: "8px 10px", background: "var(--red-dim)", border: "1px solid var(--red)", fontSize: "10px", color: "var(--red)", wordBreak: "break-all" }}>
            {error}
          </div>
        )}

        {lastTx && !error && (
          <div style={{ marginTop: "12px", padding: "8px 10px", background: "var(--green-dim)", border: "1px solid var(--green)", fontSize: "9px", color: "var(--green)" }}>
            ✓ CONFIRMED{" "}
            <a href={`https://explorer.solana.com/tx/${lastTx}?cluster=devnet`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--amber)", textDecoration: "underline" }}>
              VIEW ON EXPLORER ↗
            </a>
          </div>
        )}

        {/* Wallet info */}
        {publicKey && (
          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--border)", fontSize: "9px", color: "var(--text-faint)" }}>
            <div style={{ letterSpacing: "0.1em" }}>WALLET</div>
            <div style={{ color: "var(--text-dim)", marginTop: "2px", wordBreak: "break-all" }}>
              {publicKey.toBase58()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
