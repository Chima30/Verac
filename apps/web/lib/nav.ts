import { Activity, BadgeCheck, Banknote, Boxes, Building2, ClipboardCheck, FileLock2, Flag, FlaskConical, Gauge, Gavel, HandCoins, Landmark, ListChecks, Plug, Receipt, ScanSearch, ScrollText, ShieldAlert, ShieldCheck, Swords, TrendingUp, Users, Vote, Wallet, Waypoints, Bot, type LucideIcon } from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon }
export interface NavSection { title: string; items: NavItem[] }

export const NAV: NavSection[] = [
  { title: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: Gauge },
    { href: "/command-center", label: "AI Command Center", icon: Bot },
    { href: "/tasks", label: "Tasks", icon: ListChecks },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/proof", label: "Live Proof", icon: BadgeCheck },
  ] },
  { title: "Finance", items: [
    { href: "/treasury", label: "Treasury", icon: Landmark },
    { href: "/invoices", label: "Bills and Invoices", icon: Receipt },
    { href: "/payroll", label: "Payroll", icon: Banknote },
    { href: "/revenue", label: "Revenue", icon: HandCoins },
    { href: "/strategies", label: "DCA and Rebalancing", icon: TrendingUp },
    { href: "/arbitrage", label: "Arbitrage Lab", icon: FlaskConical },
  ] },
  { title: "Operations", items: [
    { href: "/procurement", label: "Procurement", icon: Boxes },
    { href: "/grants", label: "Grants", icon: Flag },
    { href: "/milestones", label: "Milestones", icon: Waypoints },
    { href: "/governance", label: "DAO Governance", icon: Vote },
    { href: "/disputes", label: "Disputes", icon: Gavel },
  ] },
  { title: "Security", items: [
    { href: "/vault", label: "Document Vault", icon: FileLock2 },
    { href: "/policies", label: "Policies", icon: ScrollText },
    { href: "/threats", label: "Threat Center", icon: ShieldAlert },
    { href: "/simulator", label: "Quantum Simulator", icon: ShieldCheck },
  ] },
  { title: "Settings", items: [
    { href: "/settings/organization", label: "Organisation", icon: Building2 },
    { href: "/settings/team", label: "Team Members", icon: Users },
    { href: "/settings/agents", label: "Agent Permissions", icon: Swords },
    { href: "/settings/wallets", label: "Wallets", icon: Wallet },
    { href: "/settings/integrations", label: "Integrations", icon: Plug },
    { href: "/settings/audit", label: "Audit History", icon: ScanSearch },
  ] },
];
export const ALL_ITEMS = NAV.flatMap((s) => s.items);
