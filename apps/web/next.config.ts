import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@qoreops/shared-types", "@qoreops/policy-engine", "@qoreops/ai-provider", "@qoreops/agent-coordinator", "@qoreops/qorechain"],
  serverExternalPackages: ["@qorechain/sdk", "@qorechain/qoreseal"],
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
