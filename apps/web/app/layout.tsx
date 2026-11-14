import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac";
export const metadata: Metadata = { title: { default: name, template: `%s · ${name}` }, description: "Controlled, auditable AI agents for organisations on QoreChain (testnet)." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="verac-theme">{children}</ThemeProvider></body>
    </html>
  );
}
