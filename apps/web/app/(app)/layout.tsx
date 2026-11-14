import { Shell } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell productName={process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Verac"}>{children}</Shell>;
}
