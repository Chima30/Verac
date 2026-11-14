import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@qoreops/shared-types", "@qoreops/policy-engine", "@qoreops/ai-provider", "@qoreops/agent-coordinator", "@qoreops/qorechain"],
  // Monorepo: trace server dependencies from the repo root so hoisted packages (@qorechain/sdk) ship to the serverless bundle.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  serverExternalPackages: [],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ] }];
  },
};
export default config;
