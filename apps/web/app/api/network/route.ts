import { NextResponse } from "next/server";
import { reader } from "@/lib/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Public, read-only: is Diana testnet reachable, and what is the latest EVM block. Used by the status pill in the top bar. */
export async function GET(req: Request) {
  const tooMany = await rateLimit(req, "read");
  if (tooMany) return tooMany;
  const at = new Date().toISOString();
  try {
    const q = reader();
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timed out after 8 seconds")), 8000));
    const chainId = await Promise.race([q.assertConnectedToTestnet(), timeout]);
    const block = await Promise.race([q.evm.getBlockNumber(), timeout]);
    return NextResponse.json({ ok: true, chainId, block: block.toString(), at }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), at }, { headers: { "cache-control": "no-store" } });
  }
}
