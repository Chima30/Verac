"use server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

const back = (kind: "msg" | "error", text: string, path = "/grants"): never => redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

/**
 * Loads the SAMPLE "Web3 Developer Grants" programme: a 20,000 QOR round and three clearly labelled fictional applications
 * (Alpha, Beta, Gamma). Nothing is invented about the world: Alpha links Verac's own public repository, so its evidence is
 * real (and the report states that a link does not prove ownership); Beta gives only a demo link; Gamma reuses Alpha's
 * text and repository and claims a contract address that has no code. Administrators only; needs migrations 0019 and 0020.
 */
export async function loadGrantDemo() {
  const s = await getSession();
  const sb = await supabaseServer();
  if (!s.user || !s.org || !sb) redirect("/login?next=/grants");
  if (!["owner", "administrator"].includes(s.org!.role)) back("error", "Only an owner or administrator can load the sample programme.");
  const Q = (n: number) => (BigInt(n) * 10n ** 18n).toString();
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const { data: gid, error } = await sb!.rpc("create_grant_round", {
    p_org: s.org!.id, p_title: "SAMPLE Web3 Developer Grants", p_budget: Q(20000),
    p_description: "Sample programme with fictional applicants, for demonstrating Verac's grant review. Not a real funding call.",
    p_requirements: "Open-source developer tooling, research or education for QoreChain builders. Milestones must be verifiable. Maximum 8,000 QOR per application.",
    p_categories: ["software", "research", "education"], p_deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(), p_max_request: Q(8000), p_rubric: null,
  });
  if (error) back("error", /create_grant_round/.test(error.message) ? "The database needs migrations 0019 and 0020 first." : error.message);
  const { serviceClient } = await import("@/lib/live/service");
  let db;
  try { db = serviceClient(); } catch { back("error", "The server's database key is not configured, so the sample applications cannot be added."); }

  const alphaText = {
    overview: "Alpha builds an open-source indexer that shows grant milestone deliveries on QoreChain in one dashboard for programme managers. (Fictional sample application.)",
    problem: "Grant managers today read scattered transaction lists and spreadsheets to check whether funded teams delivered their milestones on time.",
    solution: "We index milestone transactions and contract events, link them to grant agreements, and publish a documented read-only API and a dashboard.",
    technical: "TypeScript indexer with Postgres, read-only RPC access to Diana, CI with unit and integration tests on every commit.",
  };
  const decl = { accurate: true, rights: true, conflicts_disclosed: true };
  const apps = [
    {
      name: "SAMPLE Project Alpha", requested: 4000, recipient: "0xA1fA000000000000000000000000000000000001",
      content: {
        ...alphaText, team: "Two engineers who maintain an SDK (fictional).", experience: "Maintainers of an open-source TypeScript SDK since 2025 (fictional).",
        metrics: "Three grant programmes use the API within two months of release, measured by API keys issued.", timeline: "Eight weeks.",
        links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: [], transactions: [],
        budget: [{ item: "Engineer A: 8 weeks at 250 QOR per week", amount: Q(2000) }, { item: "Engineer B: 6 weeks at 250 QOR per week", amount: Q(1500) }, { item: "Hosting and RPC for 12 months", amount: Q(500) }],
        milestones: [
          { title: "Indexer MVP", deliverable: "Indexer deployed against Diana with documented endpoints and tests.", verification: "Public endpoint URL and a tagged release on GitHub.", due: day(30), amount: Q(2000) },
          { title: "Dashboard and API v1", deliverable: "Dashboard published and API v1 released with usage documentation.", verification: "Dashboard URL, release v1.0 and the documentation site.", due: day(60), amount: Q(2000) },
        ],
        declarations: decl,
      },
    },
    {
      name: "SAMPLE Project Beta", requested: 7000, recipient: "0xBe7A000000000000000000000000000000000002",
      content: {
        overview: "Beta is a wallet analytics tool for DAO treasurers that tracks outgoing grant payments over time. (Fictional sample application.)",
        problem: "Treasurers lack a clear view of outgoing grant payments over time across many wallets.",
        solution: "We extend Beta with grant payment tracking and alerts for overdue milestones, with exports.",
        technical: "Next.js application with a Rust backend.", team: "Three developers (fictional).", metrics: "Ten DAOs onboarded within three months.", timeline: "Ten weeks.",
        links: { demo: "https://verac-web.vercel.app" }, contracts: [], transactions: [],
        budget: [{ item: "Development", amount: Q(7000) }],
        milestones: [
          { title: "Phase 1", deliverable: "Complete the protocol.", verification: "Trust us", due: day(20), amount: Q(3500) },
          { title: "Phase 2", deliverable: "Release v2 with alerts and exports.", verification: "Release notes and a demo video link.", due: day(50), amount: Q(3500) },
        ],
        declarations: decl,
      },
    },
    {
      name: "SAMPLE Project Gamma", requested: 3000, recipient: "0x6A3A000000000000000000000000000000000003",
      content: {
        ...alphaText, overview: alphaText.overview.replace("Alpha", "Gamma"), team: "One engineer (fictional).", metrics: "Programmes onboarded within two months.", timeline: "Six weeks.",
        links: { repos: ["https://github.com/Chima30/Verac"] }, contracts: ["0x000000000000000000000000000000000000dEaD"], transactions: [],
        budget: [{ item: "Engineering", amount: Q(2500) }, { item: "Hosting", amount: Q(500) }],
        milestones: [{ title: "Indexer", deliverable: "Indexer deployed against Diana with documented endpoints.", verification: "Endpoint URL and a release tag.", due: day(30), amount: Q(3000) }],
        declarations: decl,
      },
    },
  ];
  for (const a of apps) {
    const applicant = crypto.randomUUID(); // a fictional applicant with no login
    const { data: row, error: e1 } = await db!.from("grant_applications").insert({
      organization_id: s.org!.id, grant_id: gid, applicant_user_id: applicant, applicant_name: a.name, requested_amount: Q(a.requested), status: "submitted", category: "software",
      content: a.content, recipient_address: a.recipient, version: 1, submitted_at: new Date().toISOString(),
      pitch: `${a.content.overview}\n\n${a.content.problem}\n\n${a.content.solution}`.slice(0, 6000),
    }).select("id").single();
    if (e1 || !row) back("error", `Could not add ${a.name}: ${e1?.message}`);
    await db!.from("grant_application_versions").insert({ organization_id: s.org!.id, application_id: row!.id, version: 1, requested_amount: Q(a.requested), category: "software", recipient_address: a.recipient, content: a.content, changed_by: applicant, reason: "submitted (sample)" });
  }
  await db!.from("audit_events").insert({ organization_id: s.org!.id, actor: s.user!.id, action: "grant.sample_loaded", subject: String(gid), detail: { applications: 3 } });
  back("msg", "Sample programme loaded with three fictional applications. Open it and choose Investigate with agents.", `/grants/${gid as string}`);
}
