import { NextResponse } from "next/server";
import { liveStatusFlags } from "@/lib/live/config";

export const dynamic = "force-dynamic";

/** Public, read-only: which pieces of live execution are configured. Never returns a key, only names of missing variables. */
export async function GET() {
  const f = liveStatusFlags();
  return NextResponse.json({ switchOn: f.switchOn, emergencyStop: f.emergencyStop, ready: f.ready, missing: f.missing, requiredAdminApprovals: f.requiredAdminApprovals });
}
