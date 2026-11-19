import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { submitSignatureV2 } from "@/lib/live/v2";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Receives one administrator's ML-DSA-87 signature (made on their own device) for a V2 payment. The server checks it against
 * the key QoreChain has registered for that administrator before recording it; the vault checks it again when paying.
 * Whoever uploads the file does not matter for authority: the signature does.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager"].includes(s.org.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const body = z.object({ id: z.string().uuid(), signature: z.unknown() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  let sig = body.data.signature;
  if (typeof sig === "string") { try { sig = JSON.parse(sig); } catch { return NextResponse.json({ error: "Paste the whole signature file produced by the signing tool." }, { status: 400 }); } }
  try {
    const r = await submitSignatureV2(s.user.id, s.org.id, body.data.id, sig);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not record the signature." }, { status: 500 });
  }
}
