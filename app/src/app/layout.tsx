import type { Metadata } from "next";
import "./globals.css";
import SolanaWalletProvider from "../components/WalletProvider";

export const metadata: Metadata = {
  title: "Darkpool — Bridgeless Encrypted Capital Markets",
  description: "Non-custodial dark pool on Solana. Native BTC/ETH. FHE-encrypted orders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
