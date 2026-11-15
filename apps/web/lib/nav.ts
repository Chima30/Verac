import { Activity, Atom, BadgeCheck, Banknote, Boxes, Building2, ClipboardCheck, FileLock2, Flag, FlaskConical, Gauge, Gavel, HandCoins, KeyRound, Landmark, ListChecks, Plug, Receipt, ScanSearch, ScrollText, ShieldAlert, TrendingUp, Users, Vote, Wallet, Waypoints, Bot, type LucideIcon } from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; keywords?: string }
export interface NavSection { title: string; items: NavItem[] }

export const NAV: NavSection[] = [
  { title: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: Gauge, keywords: "home overview command centre" },
    { href: "/command-center", label: "AI Command Center", icon: Bot, keywords: "agents ai gemini workforce" },
    { href: "/tasks", label: "Tasks", icon: ListChecks, keywords: "work items agent tasks" },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck, keywords: "review approve reject payments queue" },
    { href: "/activity", label: "Activity", icon: Activity, keywords: "audit feed history events" },
    { href: "/proof", label: "Live Proof", icon: BadgeCheck, keywords: "evidence transactions hashes testnet explorer verify" },
  ] },
  { title: "Finance", items: [
    { href: "/treasury", label: "Treasury", icon: Landmark, keywords: "vault balance funds spending limits" },
    { href: "/invoices", label: "Bills & Invoices", icon: Receipt, keywords: "bills invoices fraud check" },
    { href: "/payroll", label: "Payroll", icon: Banknote, keywords: "contributors salary batch" },
    { href: "/revenue", label: "Revenue", icon: HandCoins, keywords: "receivables collection incoming" },
    { href: "/strategies", label: "DCA & Rebalancing", icon: TrendingUp, keywords: "dca rebalancing allocation strategy" },
    { href: "/arbitrage", label: "Arbitrage Lab", icon: FlaskConical, keywords: "arbitrage market simulation" },
  ] },
  { title: "Operations", items: [
    { href: "/procurement", label: "Procurement", icon: Boxes, keywords: "tenders bids vendors suppliers" },
    { href: "/grants", label: "Grants", icon: Flag, keywords: "funding programme applications awards" },
    { href: "/milestones", label: "Milestones", icon: Waypoints, keywords: "escrow evidence release" },
    { href: "/governance", label: "DAO Governance", icon: Vote, keywords: "proposals votes dao" },
    { href: "/disputes", label: "Disputes", icon: Gavel, keywords: "cases evidence counterparty" },
  ] },
  { title: "Security", items: [
    { href: "/vault", label: "Document Vault", icon: FileLock2, keywords: "documents encrypted files" },
    { href: "/policies", label: "Policies", icon: ScrollText, keywords: "rules policy builder limits" },
    { href: "/threats", label: "Threat Center", icon: ShieldAlert, keywords: "security incidents posture risk" },
    { href: "/simulator", label: "Quantum Simulator", icon: Atom, keywords: "post-quantum attack scenario pqc" },
  ] },
  { title: "Settings", items: [
    { href: "/settings/organization", label: "Organisation", icon: Building2, keywords: "organization org settings" },
    { href: "/settings/team", label: "Team Members", icon: Users, keywords: "members roles invite" },
    { href: "/settings/agents", label: "Agent Permissions", icon: KeyRound, keywords: "agent permissions tools" },
    { href: "/settings/wallets", label: "Wallets", icon: Wallet, keywords: "qorex wallet connect" },
    { href: "/settings/integrations", label: "Integrations", icon: Plug, keywords: "gemini supabase qorechain" },
    { href: "/settings/audit", label: "Audit History", icon: ScanSearch, keywords: "audit log" },
  ] },
];
export const ALL_ITEMS = NAV.flatMap((s) => s.items);

/** Finds the section and item for a path, including nested routes such as /procurement/[id]. */
export function locate(path: string): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem } | null = null;
  for (const section of NAV) for (const item of section.items) {
    if (path === item.href || path.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.item.href.length) best = { section, item };
    }
  }
  return best;
}

export const ROLES = {
  finance: ["owner", "administrator", "finance_manager"],
  admin: ["owner", "administrator"],
  reviewer: ["owner", "administrator", "procurement_manager"],
  external: ["vendor", "grant_applicant"],
} as const;
export const hasRole = (role: string | null | undefined, group: keyof typeof ROLES) => !!role && (ROLES[group] as readonly string[]).includes(role);

/** Actions offered in the command palette and on the dashboard. Each names who may see it; the page itself still enforces it. */
export interface QuickAction { id: string; label: string; href: string; keywords: string; allowed: (role: string | null) => boolean }
export const ACTIONS: QuickAction[] = [
  { id: "pay", label: "Request a payment", href: "/approvals#request", keywords: "create payment send pay new", allowed: (r) => hasRole(r, "finance") },
  { id: "review", label: "Review approvals", href: "/approvals", keywords: "approve reject pending queue", allowed: (r) => !!r },
  { id: "tender", label: "Create a tender", href: "/procurement#create", keywords: "new procurement tender rfp", allowed: (r) => hasRole(r, "reviewer") },
  { id: "grant", label: "Open a grant round", href: "/grants#create", keywords: "new grant programme funding", allowed: (r) => hasRole(r, "admin") },
  { id: "invoice", label: "Check an invoice for fraud", href: "/invoices", keywords: "invoice bill create check", allowed: (r) => !!r },
  { id: "doc", label: "Upload an encrypted document", href: "/vault", keywords: "upload file document", allowed: (r) => !!r && !hasRole(r, "external") },
  { id: "policy", label: "Draft a policy in plain English", href: "/policies", keywords: "policy rule draft ai", allowed: () => true },
  { id: "tx", label: "View recent vault transactions", href: "/treasury#activity", keywords: "transactions recent history vault", allowed: () => true },
  { id: "evidence", label: "Verify on-chain evidence", href: "/proof", keywords: "proof verify hash explorer", allowed: () => true },
  { id: "lookup", label: "Look up an address on Diana testnet", href: "/simulator#lookup", keywords: "address lookup balance pqc", allowed: () => true },
  { id: "agents", label: "Open the AI workforce", href: "/command-center", keywords: "ask verac ai agents", allowed: () => true },
];
