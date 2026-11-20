import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter_Tight } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// One sans family for every heading and text (Inter Tight), and one mono for labels, buttons, badges, amounts and hashes.
const sans = Inter_Tight({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-body", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-code", display: "swap" });

const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
export const metadata: Metadata = { title: { default: name, template: `%s · ${name}` }, description: "Controlled, auditable AI agents for organisations on QoreChain (testnet)." };
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#000000" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* Restores the collapsed sidebar before paint. Reads one non-sensitive preference only. */}
      <head><script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("verac-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}` }} /></head>
      {/* next-themes writes the class before first paint, so there is no flash of the wrong theme. */}
      <body><ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange storageKey="verac-theme">{children}</ThemeProvider></body>
    </html>
  );
}
