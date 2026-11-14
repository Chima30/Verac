import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiProvider } from "./index";

// Excluded from the default run (see vitest.config.ts). Run manually:
//   GEMINI_API_KEY=... npx vitest run --config /dev/null packages/ai-provider/src/provider.live.test.ts
const key = process.env.GEMINI_API_KEY;
describe.skipIf(!key)("Gemini live (synthetic data only)", () => {
  it("returns schema-valid structured output", async () => {
    const p = AiProvider.fromEnv(process.env);
    const r = await p.generateStructured({
      agent: "InvoiceFraudAgent",
      instructions: "Answer with verdict 'hold' if the text mentions a duplicate, else 'pay'.",
      input: "Invoice INV-1 is a duplicate of INV-1 with a different payout address.",
      schema: z.object({ verdict: z.enum(["pay", "hold"]) }).strict(),
    });
    expect(r.data.verdict).toBe("hold");
  });
});
