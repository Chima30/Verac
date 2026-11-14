import { AddressLookup } from "@/components/address-lookup";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Quantum Simulator" };

export default function Simulator() {
  return (
    <>
      <PageHeader title="Quantum Simulator" description="Inspect an account's real post-quantum posture on Diana testnet: hybrid PQC key status, QoreSeal KEM key and EVM authorisation window." badge={<Badge tone="live" />} />
      <Card title="What the chain enforces" className="mb-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Native transactions are hybrid-signed (secp256k1 plus ML-DSA-87).</li>
          <li>EVM transactions are classical-only and are admitted only while an authorisation window opened by a hybrid-signed message covers them.</li>
          <li>Attack scenarios (a classical-key thief) are not simulated here yet; the lookup below shows live state only.</li>
        </ul>
      </Card>
      <AddressLookup focus="pq" />
    </>
  );
}
