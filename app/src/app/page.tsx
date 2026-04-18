"use client";
import dynamic from "next/dynamic";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";
import OrderBook from "../components/OrderBook";
import SettlementFeed from "../components/SettlementFeed";
const OrderForm = dynamic(() => import("../components/OrderForm"), { ssr: false });

function Clock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toUTCString().slice(17, 25));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span style={{fontFamily:"monospace",fontSize:"11px",color:"var(--text-dim)"}}>{time} UTC</span>;
}

export default function Home() {
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
      {/* Header */}
      <header style={{borderBottom:"1px solid var(--border)",background:"var(--bg-panel)",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px",flexShrink:0}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:"15px",fontWeight:600,color:"var(--amber)",letterSpacing:"0.06em"}}>DARKPOOL</div>
            <div style={{fontSize:"9px",color:"var(--text-dim)",letterSpacing:"0.2em"}}>ENCRYPTED · BRIDGELESS</div>
          </div>
          <div style={{width:"1px",height:"28px",background:"var(--border)"}}/>
          <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
            <span className="live-dot"/>
            <span style={{fontSize:"10px",color:"var(--green)",letterSpacing:"0.1em"}}>LIVE</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"20px",flex:1,justifyContent:"center"}}>
          {[["Network","DEVNET"],["Program","5GmUdA4…s2x5"],["Encrypt","4ebfzW…ND8"],["Ika","DWaL1c…RWq"],["Fee","10 bps"]].map(([l,v])=>(
            <div key={l} style={{display:"flex",flexDirection:"column"}}>
              <span style={{fontSize:"8px",color:"var(--text-faint)",letterSpacing:"0.15em",textTransform:"uppercase"}}>{l}</span>
              <span style={{fontSize:"10px",color:"var(--text-dim)",fontFamily:"monospace"}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"12px",flexShrink:0}}>
          <Clock/>
          <WalletMultiButton/>
        </div>
      </header>

      {/* Badge strip */}
      <div style={{background:"var(--bg-raise)",borderBottom:"1px solid var(--border)",padding:"5px 16px",display:"flex",alignItems:"center",gap:"16px"}}>
        <span style={{fontSize:"9px",color:"var(--text-faint)",letterSpacing:"0.2em"}}>POWERED BY</span>
        <span style={{fontSize:"10px",color:"var(--violet)",fontWeight:500,letterSpacing:"0.1em"}}>ENCRYPT FHE</span>
        <span style={{fontSize:"9px",color:"var(--text-faint)"}}>Confidential order state · No front-running</span>
        <div style={{width:"1px",height:"12px",background:"var(--border)"}}/>
        <span style={{fontSize:"10px",color:"var(--amber)",fontWeight:500,letterSpacing:"0.1em"}}>IKA dWALLET</span>
        <span style={{fontSize:"9px",color:"var(--text-faint)"}}>Native BTC/ETH · No bridges · No custodians</span>
        <div style={{width:"1px",height:"12px",background:"var(--border)"}}/>
        <span style={{fontSize:"10px",color:"var(--green)",fontWeight:500,letterSpacing:"0.1em"}}>SOLANA</span>
        <span style={{fontSize:"9px",color:"var(--text-faint)"}}>400ms finality · Sub-cent fees</span>
      </div>

      {/* Main grid */}
      <main style={{flex:1,padding:"12px 16px",display:"grid",gridTemplateColumns:"320px 1fr 1fr",gap:"12px",alignItems:"start"}}>
        <div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:"6px"}}>
            <span style={{fontSize:"10px",fontWeight:600,color:"var(--text)",letterSpacing:"0.12em",textTransform:"uppercase"}}>Place Order</span>
            <span style={{fontSize:"8px",color:"var(--text-faint)"}}>FHE-encrypted before broadcast</span>
          </div>
          <OrderForm/>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:"6px"}}>
            <span style={{fontSize:"10px",fontWeight:600,color:"var(--text)",letterSpacing:"0.12em",textTransform:"uppercase"}}>Dark Order Book</span>
            <span style={{fontSize:"8px",color:"var(--text-faint)"}}>Prices hidden until settlement</span>
          </div>
          <OrderBook/>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:"6px"}}>
            <span style={{fontSize:"10px",fontWeight:600,color:"var(--text)",letterSpacing:"0.12em",textTransform:"uppercase"}}>Settlements</span>
            <span style={{fontSize:"8px",color:"var(--text-faint)"}}>MPC-matched · on-chain finality</span>
          </div>
          <SettlementFeed/>
        </div>
      </main>

      {/* Footer */}
      <footer style={{borderTop:"1px solid var(--border)",padding:"8px 16px",display:"flex",justifyContent:"space-between",background:"var(--bg-panel)"}}>
        <span style={{fontSize:"8px",color:"var(--text-faint)",letterSpacing:"0.12em"}}>DARKPOOL · SOLANA DEVNET · ENCRYPT 4ebfzW… · IKA DWaL1c…</span>
        <span style={{fontSize:"8px",color:"var(--text-faint)",letterSpacing:"0.1em"}}>PRE-ALPHA · NOT FOR PRODUCTION USE</span>
      </footer>
    </div>
  );
}
