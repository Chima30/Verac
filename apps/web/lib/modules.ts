/**
 * Honest status for routes whose UI is not built yet. Each entry says what exists in the repository today
 * (contracts, policy engine, agents) and what is missing. Nothing here pretends to be a working feature.
 */
export interface ModuleInfo {
  title: string;
  description: string;
  agent?: string;
  exists: string[];
  missing: string[];
}

export const MODULES: Record<string, ModuleInfo> = {
  activity: { title: "Activity", description: "Chronological feed of agent and user actions.",
    exists: ["Append-only audit_events table with trigger"], missing: ["Live feed (needs database and auth)"] },
  invoices: { title: "Bills and Invoices", description: "Invoice intake, fraud checks, and paying approved bills.", agent: "InvoiceFraudAgent",
    exists: ["InvoiceFraudAgent spec (no pay or approve tools)", "Unique constraint on org, vendor and invoice number in the schema"],
    missing: ["Invoice upload and extraction", "Payment execution wiring"] },
  strategies: { title: "DCA and Rebalancing", description: "Scheduled buys and portfolio rebalancing. Simulation only until a verified venue exists.", agent: "StrategyAgent",
    exists: ["StrategyAgent spec (market.read, proposes only)"], missing: ["Strategy builder", "Verified venue (none identified, so everything stays SIMULATION)"] },
  arbitrage: { title: "Arbitrage Lab", description: "Net-profit-after-fees opportunity analysis. Simulation only.", agent: "ArbitrageAgent",
    exists: ["ArbitrageAgent spec (market.read only)"], missing: ["Quote collection", "Profit calculator UI"] },
  vault: { title: "Document Vault", description: "Multi-recipient post-quantum encrypted documents (QoreSeal).", agent: "DocumentAgent",
    exists: ["DocumentAgent spec (never holds plaintext or keys)", "documents and document_recipients tables", "Live QoreSeal KEM-key lookup in the Quantum Simulator page"],
    missing: ["Browser-side encryption and decryption", "Storage upload", "Recipient key registration"] },
};
