/** Runs once when a server instance starts: logs any missing or malformed setting by NAME (never its value). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configWarnings } = await import("./lib/config-check");
  for (const w of configWarnings()) console.warn(w);
}
