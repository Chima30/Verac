import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Geist for the interface; Geist Mono only for hashes, addresses and technical identifiers.
const sans = Geist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
export const metadata: Metadata = { title: { default: name, template: `%s · ${name}` }, description: "Controlled, auditable AI agents for organisations on QoreChain (testnet)." };
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f6f3" }, { media: "(prefers-color-scheme: dark)", color: "#0e0f11" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* Restores the collapsed sidebar before paint. Reads one non-sensitive preference only. */}
      <head><script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("verac-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}` }} /></head>
      {/* next-themes writes the class before first paint, so there is no flash of the wrong theme. */}
      <body><ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="verac-theme">{children}</ThemeProvider></body>
    </html>
  );
}
