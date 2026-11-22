import { NextResponse } from "next/server";
import { describeMachines } from "@qoreops/shared-types";

/**
 * Every state machine in Verac as JSON, for agents and tools: states with their meaning, which are terminal, steady or
 * reserved, and every move with the function that makes it and who may cause it. Public and read-only: it describes rules,
 * not anyone's data, and is built once at deploy time (static), so it costs nothing to serve. Same content as
 * docs/STATE_MACHINES.md.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ version: 1, source: "packages/shared-types/src/state-machines.ts", machines: describeMachines() });
}
