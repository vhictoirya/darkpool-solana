"use client";
import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

const STATUS = ["OPEN", "MATCHED", "CANCELLED", "EXPIRED"];
const STATUS_COLORS = ["var(--green)", "var(--violet)", "var(--text-faint)", "var(--amber)"];

function timeLeft(expiry: number): string {
  const diff = expiry - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "EXPIRED";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "h";
  return Math.floor(diff / 86400) + "d";
}

export default function OrderBook() {
  const { connection } = useConnection();
  
  const [bids, setBids] = useState<any[]>([]);
  const [asks, setAsks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(0);

  const fetchOrders = useCallback(async () => {
    try {
      const idl = require("../lib/darkpool.json");
      const provider = new AnchorProvider(connection, { publicKey: anchor.web3.PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      const orders = await (program.account as any).order.all();
      const now = Math.floor(Date.now() / 1000);
      const open = orders.filter((o: any) => o.account.status === 0 && o.account.expiry.toNumber() > now);
      setBids(open.filter((o: any) => o.account.orderType === 0).sort((a: any, b: any) => b.account.sequence.toNumber() - a.account.sequence.toNumber()));
      setAsks(open.filter((o: any) => o.account.orderType === 1).sort((a: any, b: any) => b.account.sequence.toNumber() - a.account.sequence.toNumber()));
      setLastRefresh(Date.now());
    } catch (e) { console.error("[OrderBook]", e); }
    finally { setLoading(false); }
  }, [connection]);

  useEffect(() => {
    fetchOrders();
    const id = setInterval(fetchOrders, 5000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  const renderSide = (orders: any[], side: "bid" | "ask") => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 8px 6px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.15em", color: side === "bid" ? "var(--green)" : "var(--red)" }}>{side === "bid" ? "▲ BIDS" : "▼ ASKS"}</span>
          <span style={{ background: side === "bid" ? "var(--green-dim)" : "var(--red-dim)", color: side === "bid" ? "var(--green)" : "var(--red)", fontSize: "9px", padding: "1px 5px" }}>{orders.length}</span>
        </div>
        <span style={{ fontSize: "9px", color: "var(--violet)" }}>PRICE ENCRYPTED</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px", gap: "8px", padding: "4px 8px", fontSize: "8px", color: "var(--text-faint)", background: "var(--bg-raise)", borderBottom: "1px solid var(--border)" }}>
        <span>ORDER</span><span>TTL</span><span>STATUS</span>
      </div>
      {orders.length === 0 ? (
        <div style={{ padding: "20px 8px", fontSize: "9px", color: "var(--text-faint)", textAlign: "center" }}>NO {side === "bid" ? "BIDS" : "ASKS"}</div>
      ) : orders.slice(0, 10).map((o: any) => (
        <div key={o.publicKey.toBase58()} style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px", gap: "8px", padding: "5px 8px", borderBottom: "1px solid var(--border)", fontSize: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", color: "var(--text-dim)" }}>{o.publicKey.toBase58().slice(0,8)}…{o.publicKey.toBase58().slice(-4)}</span>
          <span style={{ color: "var(--text-faint)", fontSize: "9px" }}>{timeLeft(o.account.expiry.toNumber())}</span>
          <span style={{ color: STATUS_COLORS[o.account.status] || "var(--text-faint)", fontSize: "9px", fontWeight: 500 }}>{STATUS[o.account.status] || "?"}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", minHeight: "400px" }}>
      <div style={{ padding: "7px 8px", background: "var(--bg-raise)", borderBottom: "1px solid var(--border)", fontSize: "9px", color: "var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span><span style={{ color: "var(--violet)" }}>⬡ ENCRYPT FHE</span> Price and size hidden until MPC settlement</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{loading ? "LOADING…" : (bids.length + asks.length) + " orders"}</span>
          <button onClick={fetchOrders} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-faint)", padding: "2px 6px", fontSize: "9px", cursor: "pointer", fontFamily: "monospace" }}>REFRESH</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ borderRight: "1px solid var(--border)" }}>{renderSide(bids, "bid")}</div>
        <div>{renderSide(asks, "ask")}</div>
      </div>
      {lastRefresh > 0 && <div style={{ padding: "5px 8px", fontSize: "9px", color: "var(--text-faint)", borderTop: "1px solid var(--border)", textAlign: "right" }}>UPDATED {new Date(lastRefresh).toLocaleTimeString()}</div>}
    </div>
  );
}
