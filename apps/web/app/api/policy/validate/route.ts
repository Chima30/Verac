import { NextResponse } from "next/server";
import { describePolicy, validatePolicy } from "@qoreops/policy-engine";

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const r = validatePolicy(body);
  return NextResponse.json({ ok: r.ok, findings: r.findings, summary: r.policy ? describePolicy(r.policy) : [] });
}
