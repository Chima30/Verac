import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Inter for the interface, with tight tracking on headings; Plex Mono only for hashes, addresses and key-value facts.
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
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
