import { AddressLookup } from "@/components/address-lookup";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Wallets" };

export default function Wallets() {
  return (
    <>
      <PageHeader title="Wallets" description="Inspect an address: balance, PQC key, authorisation window, spending rules and delegated authenticators. Wallet connection and key registration are not built yet." badge={<Badge tone="live" />} />
      <AddressLookup focus="wallet" />
    </>
  );
}
