/**
 * SERVER ONLY. Reads the signing credentials from environment variables (set them as Sensitive variables in Vercel) and builds
 * the two restricted signers. Nothing here is ever returned from an API route or logged: callers get booleans and addresses.
 */
import { ChainExecution, RestrictedSigner, WindowManager, envKillSwitch, waitForVerifiedReceipt, type ExecutorChain, type ExecutorSigner, type Hex } from "@qoreops/qorechain";

export const REQUIRED_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "AGENT_EVM_PRIVATE_KEY", "AGENT_MLDSA_PUBLIC_KEY", "AGENT_MLDSA_SECRET_KEY",
  "APPROVER_EVM_PRIVATE_KEY", "APPROVER_MLDSA_PUBLIC_KEY", "APPROVER_MLDSA_SECRET_KEY",
] as const;

export function liveStatusFlags(env: Record<string, string | undefined> = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k]?.trim());
  return {
    switchOn: envKillSwitch(env).enabled(),
    emergencyStop: env.LIVE_EMERGENCY_STOP === "true",
    missing: [...missing],
    ready: missing.length === 0,
    requiredAdminApprovals: Math.min(2, Math.max(1, Number(env.LIVE_REQUIRED_ADMIN_APPROVALS ?? 1) || 1)),
    expectedAgent: env.LIVE_AGENT_ADDRESS?.trim() || null,
  };
}

export const chain = () => new ChainExecution();

export function buildExecutorParts(env: Record<string, string | undefined> = process.env): { agent: ExecutorSigner; approver: ExecutorSigner; chain: ExecutorChain } {
  const flags = liveStatusFlags(env);
  if (!flags.ready) throw new Error(`Live execution is not configured. Missing: ${flags.missing.join(", ")}`);
  const kill = envKillSwitch(env);
  const x = chain();
  const mk = (role: "agent" | "approver", p: "AGENT" | "APPROVER", expected?: `0x${string}`): ExecutorSigner => {
    const key = env[`${p}_EVM_PRIVATE_KEY`]!.trim() as Hex;
    const s = new RestrictedSigner(role, key, x.evm, kill, expected);
    const w = new WindowManager({ secp256k1PrivateKey: key, mlDsa87PublicKey: env[`${p}_MLDSA_PUBLIC_KEY`]!.trim(), mlDsa87SecretKey: env[`${p}_MLDSA_SECRET_KEY`]!.trim() }, kill);
    return { address: s.address, send: (call, expiry) => s.send(call, expiry), windows: { ensureOpen: (n) => w.ensureOpen(n), close: () => w.close() } };
  };
  const agent = mk("agent", "AGENT", (flags.expectedAgent as `0x${string}` | null) ?? undefined);
  const approver = mk("approver", "APPROVER");
  if (agent.address.toLowerCase() === approver.address.toLowerCase()) throw new Error("The agent and approver keys must be different accounts.");
  return { agent, approver, chain: { ...x, vaultPaymentHash: (a, p) => x.vaultPaymentHash(a, p), approvalsRequired: (a, p) => x.approvalsRequired(a, p), onChainApprovals: (h) => x.onChainApprovals(h), alreadyExecuted: (h) => x.alreadyExecuted(h), simulateExecutePayment: (a, p) => x.simulateExecutePayment(a, p), simulateFundEscrow: (a, p, id) => x.simulateFundEscrow(a, p, id), simulateApprovePayment: (ap, a, p) => x.simulateApprovePayment(ap, a, p), waitForReceipt: (h) => waitForVerifiedReceipt(x, h) } };
}
