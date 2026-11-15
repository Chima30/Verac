import { WalletPanel } from "@/components/wallet-panel";
import { Badge, PageHeader } from "@/components/ui";

export const metadata = { title: "Wallets" };

export default function Wallets() {
  return (
    <>
      <PageHeader
        title="Wallets"
        description="Connect QoreX to see your address, balance, post-quantum key, authorisation window and spending rules, all read from Diana testnet. Connecting asks for no signature and sends nothing. Opening or closing your own EVM window from this page is not built yet."
        badge={<Badge tone="live" />}
      />
      <WalletPanel />
    </>
  );
}
