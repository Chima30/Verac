import { defineConfig } from "vitest/config";

// Read-only checks against the real Diana testnet (no keys, no transactions): `pnpm vitest run --config vitest.live.config.ts`
export default defineConfig({
  test: { include: ["packages/**/*.live.test.ts"], exclude: ["**/node_modules/**", "packages/ai-provider/**"], environment: "node", testTimeout: 60_000 },
});
