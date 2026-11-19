import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { signingRequest } from "@/lib/live/v2";

export const dynamic = "force-dynamic";

/**
 * The signing request for one V2 payment, as a file for the administrator's own signing tool. It holds only public payment
 * fields; the tool recomputes the digest from them and shows the payment before anything is signed.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s.user || !s.org) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!["owner", "administrator", "finance_manager", "security_reviewer"].includes(s.org.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const body = await signingRequest(id.data, s.org.id);
  if (!body) return NextResponse.json({ error: "V2 payment not found." }, { status: 404 });
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="verac-v2-signing-request-${id.data.slice(0, 8)}.json"` },
  });
}
