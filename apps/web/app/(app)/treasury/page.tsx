import { AddressLookup } from "@/components/address-lookup";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Treasury" };

export default function Treasury() {
  return (
    <>
      <PageHeader title="Treasury" description="Live balance and spending-rule lookup for any treasury address. Vault balances, caps and payment history appear after the TreasuryVault is deployed." badge={<Badge tone="live" />} />
      <AddressLookup focus="balance" />
    </>
  );
}
