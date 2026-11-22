/**
 * The website's view of Verac's state machines (packages/shared-types/src/state-machines.ts): one label, one colour and
 * one meaning per state, the same on every page. Pages use these instead of keeping their own copies.
 */
import { STATE_MACHINES, nextMoves, stateOf, type MachineId } from "@qoreops/shared-types";
import type { Tone } from "@/components/ui";

export type { MachineId };
export { nextMoves, stateOf };

const states = (id: MachineId) => Object.entries(STATE_MACHINES[id].states) as Array<[string, { label: string; tone: Tone }]>;

/** state -> badge tone, for a machine. */
export const toneMap = (id: MachineId): Record<string, Tone> => Object.fromEntries(states(id).map(([k, s]) => [k, s.tone]));
/** state -> label, for a machine (sentence case; badges show it in capitals). */
export const labelMap = (id: MachineId): Record<string, string> => Object.fromEntries(states(id).map(([k, s]) => [k, s.label]));
/** Stages for a pipeline strip, in the order given. */
export const stagesOf = (id: MachineId, keys: string[]) => keys.map((key) => ({ key, label: stateOf(id, key).label }));
