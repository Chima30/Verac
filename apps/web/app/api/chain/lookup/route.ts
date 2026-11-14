import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { reader } from "@/lib/server";

export const dynamic = "force-dynamic";

type Part<T> = { ok: true; data: T } | { ok: false; error: string };
async function part<T>(p: Promise<T>): Promise<Part<T>> {
  try { return { ok: true, data: await p }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Read-only lookup of an EVM address on Diana testnet. Every field is a live query; failures are reported per field. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Enter a 0x EVM address (42 characters)." }, { status: 400 });
  try {
    const q = reader();
    await q.assertConnectedToTestnet();
    const evmAddress = address as `0x${string}`;
    const native = q.toNativeAddress(evmAddress);
    const [balance, window, pqc, kem, rules, auths] = await Promise.all([
      part(q.evmBalance(evmAddress)),
      part(q.evmWindow(native)),
      part(q.pqcStatus(native)),
      part(q.kemKey(native)),
      part(q.spendingRules(native)),
      part(q.authenticators(native)),
    ]);
    return NextResponse.json({
      address, nativeAddress: native, label: "LIVE TESTNET",
      balance: balance.ok ? { ok: true, wei: balance.data.toString(), qor: formatUnits(balance.data, 18) } : balance,
      window: window.ok ? { ok: true, data: json(window.data) } : window,
      pqc: pqc.ok ? { ok: true, data: json(pqc.data) } : pqc,
      kem: kem.ok ? { ok: true, data: json(kem.data) } : kem,
      rules: rules.ok ? { ok: true, data: json(rules.data) } : rules,
      authenticators: auths.ok ? { ok: true, data: json(auths.data) } : auths,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), label: "UNAVAILABLE" }, { status: 502 });
  }
}
