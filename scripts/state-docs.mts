/** Writes docs/STATE_MACHINES.md from the state-machine registry.  pnpm state:docs */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderStateMachinesMarkdown } from "../packages/shared-types/src/state-machines.ts";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/STATE_MACHINES.md");
writeFileSync(out, renderStateMachinesMarkdown());
console.log(`wrote ${out}`);
