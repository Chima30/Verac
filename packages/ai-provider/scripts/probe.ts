/**
 * Optional LIVE Gemini check. Makes ONE real API call and only runs when GEMINI_API_KEY is set.
 *   GEMINI_API_KEY=... pnpm ai:probe
 * Uses synthetic data only (the free tier may use submitted content to improve Google products).
 */
import { z } from "zod";
import { AiProvider, InMemoryUsageRecorder, untrustedBlock } from "../src/index";

const usage = new InMemoryUsageRecorder();
const provider = AiProvider.fromEnv(process.env, { usage });
console.log("status:", JSON.stringify(provider.status(), null, 2));
if (provider.status().state === "not_configured" || provider.status().state === "invalid_config") process.exit(0);

const Review = z.object({ verdict: z.enum(["pay", "hold"]), reasons: z.array(z.string()).max(5) }).strict();
const invoice = untrustedBlock("synthetic invoice", "Invoice INV-1001 from Acme Web Studio, 60 QOR, payout address 0x2222222222222222222222222222222222222222. Previously seen: INV-1001 at 0x3333333333333333333333333333333333333333.");
try {
  const r = await provider.generateStructured({
    agent: "InvoiceFraudAgent",
    instructions: "You review invoices for an organisation. Decide whether to hold an invoice for human review. Hold if the same invoice number was previously seen with a different payout address.",
    input: invoice,
    schema: Review,
  });
  console.log("result:", JSON.stringify(r, null, 2));
  console.log("usage:", JSON.stringify(usage.summary(), null, 2));
  console.log("each provider call:", usage.all().map((r) => `${r.status} ${r.model} ${r.latencyMs}ms`));
} catch (e) {
  console.log("each provider call:", usage.all().map((r) => `${r.status} ${r.model} ${r.latencyMs}ms`));
  console.error("live call failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exitCode = 1;
}
