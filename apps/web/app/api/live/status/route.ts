import { NextResponse } from "next/server";
import { liveStatusFlags } from "@/lib/live/config";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Public, read-only: which pieces of live execution are configured. Never returns a key, only names of missing variables. */
export async function GET(req: Request) {
  const tooMany = await rateLimit(req, "read");
  if (tooMany) return tooMany;
  const f = liveStatusFlags();
  return NextResponse.json({ switchOn: f.switchOn, emergencyStop: f.emergencyStop, ready: f.ready, missing: f.missing, requiredAdminApprovals: f.requiredAdminApprovals });
}
