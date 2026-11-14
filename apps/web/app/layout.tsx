import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// A ledger-like sans for the interface and its mono partner for figures, hashes and addresses.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
export const metadata: Metadata = { title: { default: name, template: `%s · ${name}` }, description: "Controlled, auditable AI agents for organisations on QoreChain (testnet)." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="verac-theme">{children}</ThemeProvider></body>
    </html>
  );
}
