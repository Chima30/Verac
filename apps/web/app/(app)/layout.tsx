import { Shell } from "@/components/shell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession(false);
  return <Shell productName={process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac"} account={{ configured: s.configured, email: s.user?.email ?? null }}>{children}</Shell>;
}
