import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

/**
 * Bounded, read-only fetching of applicant-supplied web pages, with SSRF protection.
 *
 *  - https only, default port or 443/8443, no credentials in the URL, hostname length and charset checked;
 *  - every address the hostname resolves to is checked AT CONNECT TIME (in the socket's lookup hook), so a DNS answer
 *    cannot be swapped for an internal address after validation (rebinding);
 *  - private, loopback, link-local, carrier-grade NAT, multicast, reserved and IPv4-mapped internal addresses are refused;
 *  - at most 3 redirects, each re-validated; 8 s timeout; 256 KB body cap; text/html or text/plain only;
 *  - no cookies, no auth headers, GET only. Nothing fetched is ever executed; the text is untrusted data.
 */

export class FetchRefused extends Error {
  constructor(readonly code: "BAD_URL" | "BLOCKED_ADDRESS" | "TOO_MANY_REDIRECTS" | "TIMEOUT" | "TOO_LARGE" | "BAD_TYPE" | "HTTP_ERROR" | "NETWORK", message: string) {
    super(message); this.name = "FetchRefused";
  }
}

const v4 = (ip: string) => ip.split(".").map(Number);
/** True for any address that is not a normal public unicast address. */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const [a, b] = v4(ip) as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (fam === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
  }
  return true;
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchRefused("BAD_URL", "Not a valid URL."); }
  if (u.protocol !== "https:") throw new FetchRefused("BAD_URL", "Only https links are fetched.");
  if (u.username || u.password) throw new FetchRefused("BAD_URL", "Links with credentials are not fetched.");
  if (u.port && !["443", "8443"].includes(u.port)) throw new FetchRefused("BAD_URL", "Only the standard https port is fetched.");
  const host = u.hostname;
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) throw new FetchRefused("BAD_URL", "The host name is not a public domain.");
  if (isIP(host) && isBlockedAddress(host)) throw new FetchRefused("BLOCKED_ADDRESS", "Internal addresses are never fetched.");
  if (/(^|\.)(localhost|local|internal|intranet|home|lan|corp)$/i.test(host)) throw new FetchRefused("BLOCKED_ADDRESS", "Internal host names are never fetched.");
  return u;
}

export interface SafeResponse { url: string; status: number; contentType: string; text: string; fetchedAt: string; redirects: string[] }

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;

function once(u: URL): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(u, {
      method: "GET", timeout: TIMEOUT_MS,
      headers: { "user-agent": "Verac-grant-research/1.0 (read-only)", accept: "text/html,text/plain;q=0.9", "accept-encoding": "identity" },
      // Validate every resolved address at connect time.
      lookup: (hostname, opts, cb) => {
        dnsLookup(hostname, { ...(opts as object), all: true }, (err, addrs) => {
          if (err) return (cb as (e: Error | null, a: string, f: number) => void)(err, "", 0);
          const list = addrs as unknown as Array<{ address: string; family: number }>;
          const bad = list.find((a) => isBlockedAddress(a.address));
          if (!list.length || bad) return (cb as (e: Error | null, a: string, f: number) => void)(new FetchRefused("BLOCKED_ADDRESS", "The host resolves to an internal address."), "", 0);
          const first = list[0]!;
          if ((opts as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
          (cb as (e: Error | null, a: string, f: number) => void)(null, first.address, first.family);
        });
      },
    }, (res) => {
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new FetchRefused("TOO_LARGE", "The page is larger than 256 KB.")); return; } chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchRefused("TIMEOUT", "The site did not answer within 8 seconds.")));
    req.on("error", (e) => reject(e instanceof FetchRefused ? e : new FetchRefused("NETWORK", e.message.slice(0, 160))));
    req.end();
  });
}

export async function safeFetch(raw: string): Promise<SafeResponse> {
  let u = validateUrl(raw);
  const redirects: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const r = await once(u);
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.location;
      if (!loc || i === 3) throw new FetchRefused("TOO_MANY_REDIRECTS", "More than 3 redirects.");
      u = validateUrl(new URL(String(loc), u).toString());
      redirects.push(u.toString());
      continue;
    }
    const type = String(r.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (r.status >= 400) throw new FetchRefused("HTTP_ERROR", `The site answered HTTP ${r.status}.`);
    if (!["text/html", "text/plain"].includes(type)) throw new FetchRefused("BAD_TYPE", `Content type ${type || "unknown"} is not read.`);
    return { url: u.toString(), status: r.status, contentType: type, text: r.body, fetchedAt: new Date().toISOString(), redirects };
  }
  throw new FetchRefused("TOO_MANY_REDIRECTS", "More than 3 redirects.");
}

/** Plain text and title from HTML, for display and for an AI prompt as untrusted data. Scripts and styles are dropped. */
export function htmlToText(html: string, max = 4000): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return { title, text: text.slice(0, max) };
}
