import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import "@/components/sodium/styles.css";
import { SodiumPortalProvider } from "@/lib/sodium/portal";

const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
export const metadata: Metadata = { title: { default: name, template: `%s · ${name}` }, description: "Controlled, auditable AI agents for organisations on QoreChain (testnet)." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="sodium min-h-dvh bg-page text-text-1"><ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem storageKey="verac-theme"><SodiumPortalProvider>{children}</SodiumPortalProvider></ThemeProvider></body>
    </html>
  );
}
