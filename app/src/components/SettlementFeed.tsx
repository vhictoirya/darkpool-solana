"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { DARKPOOL_PROGRAM_ID } from "../lib/program";

interface Settlement {
  address: string;
  maker: string;
  taker: string;
  settledPrice: bigint;
  settledSize: bigint;
  feeCollected: bigint;
  settledAt: number;
}

function ago(unix: number): string {
  const diff = Math.floor((Date.now() - unix * 1000) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function SettlementFeed() {
  const { connection } = useConnection();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const accounts = await connection.getProgramAccounts(DARKPOOL_PROGRAM_ID, {
        filters: [{ dataSize: 425 }],
      });
      const parsed: Settlement[] = [];
      for (const { pubkey, account } of accounts) {
        const d = account.data;
        const view = new DataView(d.buffer, d.byteOffset);
        try {
          const settledPrice = view.getBigUint64(392, true);
          const settledSize = view.getBigUint64(400, true);
          const feeCollected = view.getBigUint64(408, true);
          const settledAt = Number(view.getBigInt64(416, true));
          parsed.push({
            address: pubkey.toBase58(),
            maker: Buffer.from(d.slice(72, 104)).toString("hex").slice(0, 8),
            taker: Buffer.from(d.slice(104, 136)).toString("hex").slice(0, 8),
            settledPrice,
            settledSize,
            feeCollected,
            settledAt,
          });
        } catch { /* skip */ }
      }
      parsed.sort((a, b) => b.settledAt - a.settledAt);
      setSettlements(parsed);
    } catch (e) {
      console.error("[SettlementFeed]", e);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 6000);
    return () => clearInterval(id);
  }, [fetch]);

  const panelStyle = {
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    minHeight: "400px",
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{
        padding: "7px 8px",
        background: "var(--bg-raise)",
        borderBottom: "1px solid var(--border)",
        fontSize: "9px",
        color: "var(--text-faint)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span>
          <span style={{ color: "var(--amber)" }}>⬡ IKA dWALLET</span>
          {" "}MPC-matched · on-chain finality
        </span>
        <span>{loading ? "LOADING…" : `${settlements.length} total`}</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 70px",
        gap: "6px",
        padding: "5px 8px",
        fontSize: "9px",
        color: "var(--text-faint)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        background: "var(--bg-raise)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span>Price</span>
        <span>Size</span>
        <span>Fee</span>
        <span>Time</span>
      </div>

      {settlements.length === 0 ? (
        <div style={{
          padding: "30px 8px",
          textAlign: "center",
          fontSize: "10px",
          color: "var(--text-faint)",
          letterSpacing: "0.08em",
        }}>
          {loading ? "LOADING SETTLEMENTS…" : "NO SETTLEMENTS YET"}
          {!loading && (
            <div style={{ marginTop: "6px", fontSize: "9px", color: "var(--text-faint)" }}>
              Place and match orders to see settlements here
            </div>
          )}
        </div>
      ) : (
        settlements.slice(0, 12).map((s) => (
          <div
            key={s.address}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 70px",
              gap: "6px",
              padding: "7px 8px",
              borderBottom: "1px solid var(--border)",
              fontSize: "10px",
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--text)", fontFamily: "monospace" }}>
              {(Number(s.settledPrice) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span style={{ color: "var(--text-dim)", fontFamily: "monospace" }}>
              {(Number(s.settledSize) / 1e8).toFixed(4)}
            </span>
            <span style={{ color: "var(--amber-dim)", fontFamily: "monospace", fontSize: "9px" }}>
              {s.feeCollected.toString()}
            </span>
            <span style={{ color: "var(--text-faint)", fontSize: "9px" }}>
              {s.settledAt > 0 ? ago(s.settledAt) : "—"}
            </span>
          </div>
        ))
      )}

      {/* Summary */}
      {settlements.length > 0 && (
        <div style={{
          padding: "7px 8px",
          borderTop: "1px solid var(--border)",
          fontSize: "9px",
          color: "var(--text-faint)",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>TOTAL SETTLEMENTS: {settlements.length}</span>
          <span>PROGRAM: 5GmUdA4…s2x5</span>
        </div>
      )}
    </div>
  );
}
