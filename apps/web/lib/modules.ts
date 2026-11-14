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
  invoices: { title: "Bills and Invoices", description: "Invoice intake, fraud checks, and paying approved bills.", agent: "InvoiceFraudAgent",
    exists: ["InvoiceFraudAgent spec (no pay or approve tools)", "Unique constraint on org, vendor and invoice number in the schema"],
    missing: ["Invoice upload and extraction", "Payment execution wiring"] },
  strategies: { title: "DCA and Rebalancing", description: "Scheduled buys and portfolio rebalancing. Simulation only until a verified venue exists.", agent: "StrategyAgent",
    exists: ["StrategyAgent spec (market.read, proposes only)"], missing: ["Strategy builder", "Verified venue (none identified, so everything stays SIMULATION)"] },
  arbitrage: { title: "Arbitrage Lab", description: "Net-profit-after-fees opportunity analysis. Simulation only.", agent: "ArbitrageAgent",
    exists: ["ArbitrageAgent spec (market.read only)"], missing: ["Quote collection", "Profit calculator UI"] },
};
