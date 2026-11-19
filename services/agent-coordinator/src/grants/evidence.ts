/**
 * Evidence about a grant application, collected from real sources, never invented.
 *
 * Every item says where it came from (URL), when, what was OBSERVED (facts as returned by the source), which applicant
 * CLAIM it relates to, and a classification with a reason:
 *   VERIFIED            the source confirms the claim
 *   PARTIALLY_VERIFIED  the source confirms part of it
 *   UNVERIFIED          the source neither confirms nor contradicts it (or nothing was claimed that it can check)
 *   CONTRADICTED        the source contradicts the claim
 *   UNAVAILABLE         the source could not be read (not found, private, rate limited, network). Not a negative finding.
 *
 * GitHub is read through its REST API (https://docs.github.com/en/rest). Nothing is cloned or executed. Popularity signals
 * (stars, followers) are deliberately not collected. A missing or private repository is UNAVAILABLE, not evidence of fraud,
 * and a link does not prove ownership.
 */

export type EvidenceStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED" | "UNAVAILABLE";
export interface Evidence {
  source: "github" | "qorechain" | "web";
  subject: string;
  claim: string;
  status: EvidenceStatus;
  reason: string;
  observed: Record<string, unknown>;
  url: string;
  retrievedAt: string;
  /** Untrusted text (README, page text) for an AI to read inside an <untrusted> block. Never instructions. */
  untrustedText?: string;
}

export interface HttpJson { status: number; json: unknown; headers: Record<string, string | null> }
export type GetJson = (url: string) => Promise<HttpJson>;

export function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

const API = "https://api.github.com";
const now = () => new Date().toISOString();

/** Builds a GitHub JSON getter with an optional server-side token. The token never leaves this function. */
export function githubGetter(token?: string, fetchImpl: typeof fetch = fetch): GetJson {
  return async (url) => {
    if (!url.startsWith(`${API}/`)) throw new Error("only api.github.com is read");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetchImpl(url, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Verac-grant-research", ...(token ? { authorization: `Bearer ${token}` } : {}) }, redirect: "error", signal: ctrl.signal });
      const text = await r.text();
      if (text.length > 2_000_000) throw new Error("response too large");
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      const h = (k: string) => r.headers.get(k);
      return { status: r.status, json, headers: { "x-ratelimit-remaining": h("x-ratelimit-remaining"), "x-ratelimit-reset": h("x-ratelimit-reset"), link: h("link") } };
    } finally { clearTimeout(t); }
  };
}

function rateLimited(r: HttpJson): string | null {
  if ((r.status === 403 || r.status === 429) && r.headers["x-ratelimit-remaining"] === "0") {
    const reset = Number(r.headers["x-ratelimit-reset"]);
    return `GitHub rate limit reached${reset ? `; resets at ${new Date(reset * 1000).toISOString()}` : ""}. Try again later or configure a server-side GITHUB_TOKEN.`;
  }
  return null;
}

const CI_FILES = [".github/workflows", ".gitlab-ci.yml", ".circleci", "azure-pipelines.yml", ".travis.yml"];
const TEST_HINTS = /^(test|tests|__tests__|spec|e2e)$|\.(test|spec)\.[jt]sx?$|^foundry\.toml$|^hardhat\.config|^jest\.config|^vitest\.config|^pytest\.ini$|^Cargo\.toml$/i;

/** Reads one public repository through the GitHub REST API and returns evidence items. */
export async function githubEvidence(repoUrl: string, get: GetJson, claims: { technical?: string } = {}): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const parsed = parseRepo(repoUrl);
  const base = { source: "github" as const, subject: repoUrl };
  if (!parsed) return [{ ...base, claim: "A GitHub repository link", status: "UNAVAILABLE", reason: "Not a github.com/owner/name link, so it was not read.", observed: {}, url: repoUrl, retrievedAt: now() }];
  const { owner, repo } = parsed;
  const R = `${API}/repos/${owner}/${repo}`;

  let r: HttpJson;
  try { r = await get(R); } catch (e) {
    return [{ ...base, claim: "The repository exists", status: "UNAVAILABLE", reason: `GitHub could not be reached: ${(e as Error).message.slice(0, 120)}`, observed: {}, url: R, retrievedAt: now() }];
  }
  const limited = rateLimited(r);
  if (limited) return [{ ...base, claim: "The repository exists", status: "UNAVAILABLE", reason: limited, observed: {}, url: R, retrievedAt: now() }];
  if (r.status === 404) return [{ ...base, claim: "The repository exists and is public", status: "UNAVAILABLE", reason: "GitHub answered 404: the repository does not exist, or it is private. A private repository is acceptable; ask the applicant for another way to show the work.", observed: { httpStatus: 404 }, url: R, retrievedAt: now() }];
  if (r.status !== 200 || !r.json) return [{ ...base, claim: "The repository exists", status: "UNAVAILABLE", reason: `GitHub answered HTTP ${r.status}.`, observed: { httpStatus: r.status }, url: R, retrievedAt: now() }];
  const j = r.json as Record<string, unknown>;
  const meta = {
    fullName: j.full_name, description: j.description ?? null, defaultBranch: j.default_branch, visibility: j.visibility ?? (j.private ? "private" : "public"),
    fork: !!j.fork, parent: (j.parent as { full_name?: string } | undefined)?.full_name ?? null, archived: !!j.archived,
    createdAt: j.created_at, pushedAt: j.pushed_at, updatedAt: j.updated_at, license: (j.license as { spdx_id?: string } | null)?.spdx_id ?? null, openIssues: j.open_issues_count,
    primaryLanguage: j.language ?? null, sizeKb: j.size,
  };
  out.push({ ...base, claim: "The repository exists and is public", status: "VERIFIED", reason: `GitHub returned the repository ${String(meta.fullName)}${meta.fork ? ` (a fork of ${meta.parent ?? "another repository"}; forks and reuse of open source are legitimate, but the original work is not the applicant's)` : ""}.`, observed: meta, url: R, retrievedAt: now() });

  // Languages, recent commits, contributors, pull requests, releases: one page each (bounded), counted as returned.
  const page = async (path: string): Promise<{ list: unknown[] | null; note?: string; url: string }> => {
    const url = `${R}${path}`;
    try {
      const x = await get(url);
      if (rateLimited(x)) return { list: null, note: rateLimited(x)!, url };
      if (x.status === 409) return { list: [], note: "The repository is empty.", url };
      if (x.status !== 200) return { list: null, note: `HTTP ${x.status}`, url };
      return { list: Array.isArray(x.json) ? x.json : x.json && typeof x.json === "object" ? [x.json] : [], url };
    } catch (e) { return { list: null, note: (e as Error).message.slice(0, 120), url }; }
  };
  const langs = await page("/languages");
  const commits = await page("/commits?per_page=30");
  const contributors = await page("/contributors?per_page=30");
  const pulls = await page("/pulls?state=all&per_page=30");
  const releases = await page("/releases?per_page=10");
  const root = await page("/contents/");

  const commitDates = (commits.list ?? []).map((c) => (c as { commit?: { author?: { date?: string } } }).commit?.author?.date).filter(Boolean) as string[];
  const commitAuthors = new Set((commits.list ?? []).map((c) => (c as { author?: { login?: string } | null; commit?: { author?: { email?: string } } }).author?.login ?? (c as { commit?: { author?: { email?: string } } }).commit?.author?.email ?? "unknown"));
  const files = (root.list ?? []).map((f) => ({ name: String((f as { name?: string }).name ?? ""), type: String((f as { type?: string }).type ?? "") }));
  const hasReadme = files.some((f) => /^readme(\.|$)/i.test(f.name));
  const ciTop = files.some((f) => CI_FILES.some((c) => f.name === c || f.name === c.split("/")[0]));
  const testHints = files.filter((f) => TEST_HINTS.test(f.name)).map((f) => f.name);
  let workflows: string[] = [];
  if (files.some((f) => f.name === ".github")) {
    const wf = await page("/contents/.github/workflows");
    workflows = (wf.list ?? []).map((f) => String((f as { name?: string }).name ?? "")).filter(Boolean);
  }
  const activity = {
    languages: langs.list?.[0] ?? null, recentCommitsReturned: commitDates.length, newestCommit: commitDates[0] ?? null, oldestCommitInPage: commitDates[commitDates.length - 1] ?? null,
    distinctCommitAuthorsInPage: commitAuthors.size, contributorsReturned: contributors.list?.length ?? null, pullRequestsReturned: pulls.list?.length ?? null,
    releasesReturned: releases.list?.length ?? null, latestRelease: (releases.list?.[0] as { tag_name?: string; published_at?: string } | undefined)?.tag_name ?? null,
    rootFiles: files.slice(0, 60).map((f) => `${f.name}${f.type === "dir" ? "/" : ""}`), readme: hasReadme, ciWorkflows: workflows, ciConfigAtRoot: ciTop, testIndicators: testHints,
    notes: [commits, contributors, pulls, releases, root].map((p) => p.note).filter(Boolean),
  };
  const anyActivity = commitDates.length > 0;
  out.push({
    ...base, claim: "There is development activity in the repository", status: anyActivity ? "VERIFIED" : commits.list === null ? "UNAVAILABLE" : "UNVERIFIED",
    reason: anyActivity ? `${commitDates.length} commit(s) returned in the first page, newest ${commitDates[0]}. Commit counts are not a measure of quality.` : commits.list === null ? `Commits could not be read: ${commits.note}.` : "No commits were returned (the repository may be new or empty). This is not a negative finding on its own.",
    observed: activity, url: commits.url, retrievedAt: now(),
  });
  out.push({
    ...base, claim: "Tests or continuous integration are configured", status: workflows.length || ciTop || testHints.length ? "VERIFIED" : root.list === null ? "UNAVAILABLE" : "UNVERIFIED",
    reason: workflows.length || ciTop || testHints.length ? `Found ${[workflows.length ? `CI workflows (${workflows.join(", ")})` : "", ciTop ? "CI configuration" : "", testHints.length ? `test indicators (${testHints.join(", ")})` : ""].filter(Boolean).join("; ")} in the repository root. Configuration is not proof that tests pass.`
      : root.list === null ? `The file list could not be read: ${root.note}.` : "No CI workflow or test indicator was found at the repository root. Tests may live elsewhere; ask the applicant.",
    observed: { ciWorkflows: workflows, ciConfigAtRoot: ciTop, testIndicators: testHints }, url: root.url, retrievedAt: now(),
  });

  // README text, for an AI to read as untrusted data (capped).
  if (hasReadme) {
    const rd = await page("/readme");
    const content = (rd.list?.[0] as { content?: string; encoding?: string } | undefined);
    if (content?.content && content.encoding === "base64") {
      const text = Buffer.from(content.content, "base64").toString("utf8").slice(0, 12_000);
      out.push({ ...base, claim: "The README describes the project", status: "UNVERIFIED", reason: "README text retrieved for review. Its statements are the applicant's own claims.", observed: { readmeChars: text.length }, url: rd.url, retrievedAt: now(), untrustedText: text });
    }
  }
  if (claims.technical && /\b(test(s|ed|ing)?|ci|continuous integration)\b/i.test(claims.technical) && !(workflows.length || ciTop || testHints.length) && root.list !== null) {
    out.push({ ...base, claim: "The application says the project has tests or CI", status: "UNVERIFIED", reason: "The application mentions tests or CI, but none were found at the repository root. They may be elsewhere; ask the applicant where.", observed: {}, url: root.url, retrievedAt: now() });
  }
  return out;
}

/** Minimal chain reader the evidence needs (QoreReader's public client fits). */
export interface ChainRead {
  chainId(): Promise<number>;
  getCode(address: string): Promise<string | undefined>;
  getReceipt(hash: string): Promise<{ status: "success" | "reverted"; blockNumber: bigint; to: string | null; from: string } | null>;
}

export async function chainEvidence(c: ChainRead, contracts: string[], txs: string[], explorer = "https://explore.qore.network"): Promise<Evidence[]> {
  const out: Evidence[] = [];
  let chain: number;
  try { chain = await c.chainId(); } catch (e) {
    return [...contracts, ...txs].map((s) => ({ source: "qorechain", subject: s, claim: "On-chain reference", status: "UNAVAILABLE", reason: `The QoreChain RPC could not be reached: ${(e as Error).message.slice(0, 100)}`, observed: {}, url: explorer, retrievedAt: now() }));
  }
  if (chain !== 9800) return [{ source: "qorechain", subject: "network", claim: "Diana testnet", status: "UNAVAILABLE", reason: `The RPC reports chain ${chain}, not Diana (9800); nothing was checked.`, observed: { chainId: chain }, url: explorer, retrievedAt: now() }];
  for (const a of contracts) {
    try {
      const code = await c.getCode(a);
      const has = !!code && code !== "0x";
      out.push({ source: "qorechain", subject: a, claim: "A contract is deployed at this address on Diana", status: has ? "VERIFIED" : "CONTRADICTED",
        reason: has ? `Bytecode exists (${(code!.length - 2) / 2} bytes). This shows a contract exists; it does not show that it is the applicant's, audited, or functional.` : "There is no contract code at this address on Diana testnet.",
        observed: { chainId: chain, codeBytes: has ? (code!.length - 2) / 2 : 0 }, url: `${explorer}/address/${a}`, retrievedAt: now() });
    } catch (e) { out.push({ source: "qorechain", subject: a, claim: "A contract is deployed at this address", status: "UNAVAILABLE", reason: (e as Error).message.slice(0, 120), observed: {}, url: `${explorer}/address/${a}`, retrievedAt: now() }); }
  }
  for (const h0 of txs) {
    const h = h0.startsWith("0x") ? h0 : `0x${h0}`;
    try {
      const r = await c.getReceipt(h);
      out.push({ source: "qorechain", subject: h, claim: "This transaction happened on Diana", status: r ? (r.status === "success" ? "VERIFIED" : "PARTIALLY_VERIFIED") : "CONTRADICTED",
        reason: r ? (r.status === "success" ? `Included in block ${r.blockNumber} and succeeded.` : `Included in block ${r.blockNumber} but reverted.`) : "No EVM receipt with this hash exists on Diana testnet (a native-lane transaction would not have one; ask the applicant).",
        observed: r ? { chainId: chain, block: r.blockNumber.toString(), status: r.status, from: r.from, to: r.to } : { chainId: chain }, url: `${explorer}/tx/${h}`, retrievedAt: now() });
    } catch (e) { out.push({ source: "qorechain", subject: h, claim: "This transaction happened", status: "UNAVAILABLE", reason: (e as Error).message.slice(0, 120), observed: {}, url: `${explorer}/tx/${h}`, retrievedAt: now() }); }
  }
  return out;
}

/** Website reachability through the SSRF-safe fetcher (injected so tests need no network). */
export async function webEvidence(url: string, fetchPage: (u: string) => Promise<{ url: string; status: number; text: string; fetchedAt: string; redirects: string[] }>, toText: (html: string) => { title: string | null; text: string }): Promise<Evidence> {
  try {
    const r = await fetchPage(url);
    const t = toText(r.text);
    return { source: "web", subject: url, claim: "The project website is online", status: "VERIFIED", reason: `Fetched (HTTP ${r.status})${t.title ? `, title "${t.title.slice(0, 120)}"` : ""}. Reachability says nothing about quality.`, observed: { finalUrl: r.url, redirects: r.redirects, title: t.title, textChars: t.text.length }, url: r.url, retrievedAt: r.fetchedAt, untrustedText: t.text };
  } catch (e) {
    return { source: "web", subject: url, claim: "The project website is online", status: "UNAVAILABLE", reason: `Not fetched: ${(e as Error).message.slice(0, 160)}`, observed: { code: (e as { code?: string }).code ?? null }, url, retrievedAt: now() };
  }
}
