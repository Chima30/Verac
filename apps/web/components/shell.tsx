"use client";
import { Bell, Building2, ChevronDown, ChevronRight, LogIn, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LABS, NAV, locate } from "@/lib/nav";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export interface ShellProps {
  productName: string;
  account: { configured: boolean; email: string | null };
  org: { name: string; role: string } | null;
  /** Payment requests in this organisation waiting for a human decision (live and simulated). Null when unknown. */
  pending: number | null;
  children: ReactNode;
}

const GROUPS_KEY = "verac-nav-groups";
const SIDEBAR_KEY = "verac-sidebar";
const role = (r: string) => r.replaceAll("_", " ");

/** Small popover menu: closes on outside click and Escape, returns focus to its button. */
function Menu_({ button, label, children, align = "right" }: { button: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode; label: string; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      {button({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && (
        <div role="menu" aria-label={label} className={`motion-pop absolute top-[calc(100%+6px)] z-50 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-pop ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function NetworkPill() {
  const [s, setS] = useState<{ ok: boolean; block?: string; error?: string; at?: string } | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try { const r = await fetch("/api/network", { cache: "no-store" }); const j = await r.json(); if (!stop) setS(j); } catch { if (!stop) setS({ ok: false, error: "Network request failed" }); }
    };
    load();
    const t = setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, []);
  const tone = s === null ? "var(--subtle)" : s.ok ? "var(--live)" : "var(--bad)";
  const title = s === null ? "Checking Diana testnet…" : s.ok ? `Diana testnet reachable. Latest EVM block ${s.block}, read ${new Date(s.at!).toLocaleTimeString()}.` : `Diana testnet unreachable: ${s.error}`;
  return (
    <span title={title} className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12px] text-muted">
      <span aria-hidden className="relative flex size-2">{s?.ok && <span className="absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden" style={{ background: tone, animationDuration: "2.4s" }} />}<span className="relative size-2 rounded-full" style={{ background: tone }} /></span>
      <span className="hidden sm:inline">Diana testnet</span>
      <span className="hidden font-mono text-[11.5px] text-subtle xl:inline">{s?.ok ? `#${Number(s.block).toLocaleString("en-US")}` : s ? "offline" : "…"}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function Shell({ productName, account, org, pending, children }: ShellProps) {
  const path = usePathname();
  const here = locate(path);
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<string[]>([LABS]);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    try { setClosed(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? JSON.stringify([LABS]))); } catch { setClosed([LABS]); }
  }, []);
  useEffect(() => { setMobile(false); setTip(null); }, [path]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next); setTip(null);
    if (next) document.documentElement.dataset.sidebar = "collapsed"; else delete document.documentElement.dataset.sidebar;
    try { localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded"); } catch { /* ignore */ }
  };
  const toggleGroup = (t: string) => setClosed((c) => {
    const next = c.includes(t) ? c.filter((x) => x !== t) : [...c, t];
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const closePalette = useCallback(() => setPalette(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !palette && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette]);

  // Mobile drawer: Escape closes, focus moves in and is kept inside.
  useEffect(() => {
    if (!mobile) return;
    const el = drawer.current;
    el?.querySelector<HTMLElement>("a[aria-current], a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("a, button")]; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [mobile]);

  const showTip = (label: string) => (e: React.MouseEvent | React.FocusEvent) => {
    if (!collapsed || window.innerWidth < 1024) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };

  const nav = (inDrawer: boolean) => (
    <nav aria-label="Main" className="scroll-quiet flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-1" onScroll={() => setTip(null)}>
      {NAV.map((s) => {
        const containsActive = s.items.some((i) => path === i.href || path.startsWith(`${i.href}/`));
        const isOpen = !closed.includes(s.title) || containsActive;
        const gid = `nav-${s.title.toLowerCase()}-${inDrawer ? "m" : "d"}`;
        return (
          <div key={s.title} className="mt-4 first:mt-1">
            <button type="button" onClick={() => toggleGroup(s.title)} aria-expanded={isOpen} aria-controls={gid}
              className={`group label-mono flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-left text-subtle hover:text-ink ${inDrawer ? "" : "lg:collapsed:hidden"}`}>
              {s.title}<ChevronRight size={12} aria-hidden className={`ml-auto opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 ${isOpen ? "rotate-90" : ""}`} />
            </button>
            {!inDrawer && <div aria-hidden className="mx-3 my-2 hidden h-px bg-line lg:collapsed:block" />}
            <ul id={gid} className={`space-y-px ${isOpen ? "" : inDrawer ? "hidden" : "hidden lg:collapsed:block"}`}>
              {s.items.map(({ href, label, icon: Icon }) => {
                const active = path === href || path.startsWith(`${href}/`);
                const badge = href === "/approvals" && pending ? pending : null;
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? "page" : undefined} aria-label={!inDrawer && collapsed ? label : undefined}
                      onMouseEnter={inDrawer ? undefined : showTip(label)} onMouseLeave={() => setTip(null)} onFocus={inDrawer ? undefined : showTip(label)} onBlur={() => setTip(null)}
                      className={`relative flex h-9 items-center gap-3 rounded-[4px] px-2.5 text-[15px] tracking-[-0.01em] ${!inDrawer ? "lg:collapsed:justify-center lg:collapsed:px-0" : ""} ${active ? "font-medium text-ink" : "text-ink/80 hover:bg-surface-2 hover:text-ink"}`}>
                      {active && <span aria-hidden className={`absolute -left-1 top-1/2 h-[2px] w-3 -translate-y-1/2 bg-[var(--ring)] ${!inDrawer ? "lg:collapsed:hidden" : ""}`} />}
                      <Icon size={17} strokeWidth={active ? 2 : 1.75} aria-hidden className="shrink-0" />
                      <span className={`truncate ${!inDrawer ? "lg:collapsed:hidden" : ""}`}>{label}</span>
                      {badge && <span className={`ml-auto rounded-md bg-[var(--warn-bg)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--warn)] ${!inDrawer ? "lg:collapsed:absolute lg:collapsed:right-1 lg:collapsed:top-0.5 lg:collapsed:px-1 lg:collapsed:text-[9.5px]" : ""}`}>{badge}<span className="sr-only"> waiting</span></span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const orgBlock = (inDrawer: boolean) => org ? (
    <Link href="/settings/organization" className={`mx-3 mb-3 flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 hover:border-line-strong ${inDrawer ? "" : "lg:collapsed:mx-2 lg:collapsed:justify-center lg:collapsed:border-0 lg:collapsed:bg-transparent lg:collapsed:px-0"}`}
      onMouseEnter={inDrawer ? undefined : showTip(org.name)} onMouseLeave={() => setTip(null)}>
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-[12px] font-semibold text-accent-text">{org.name.slice(0, 1).toUpperCase()}</span>
      <span className={`min-w-0 ${inDrawer ? "" : "lg:collapsed:hidden"}`}><span className="block truncate text-[13px] font-medium">{org.name}</span><span className="block truncate text-[11.5px] capitalize text-muted">{role(org.role)}</span></span>
    </Link>
  ) : null;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[15.5rem] flex-col border-r border-line bg-bg transition-[width] duration-200 lg:flex lg:collapsed:w-16">
        <div className="flex h-14 shrink-0 items-center justify-between px-4 lg:collapsed:justify-center lg:collapsed:px-0">
          <Link href="/dashboard" className="min-w-0 rounded-md lg:collapsed:hidden"><Logo name={productName} /></Link>
          <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}
            className="grid size-8 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-ink">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        </div>
        <button type="button" onClick={() => setPalette(true)} onMouseEnter={showTip("Search  Ctrl K")} onMouseLeave={() => setTip(null)}
          className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-subtle hover:border-line-strong hover:text-muted lg:collapsed:mx-auto lg:collapsed:w-10 lg:collapsed:justify-center lg:collapsed:px-0">
          <Search size={14} aria-hidden /><span className="lg:collapsed:hidden">Search…</span>
          <kbd className="ml-auto font-mono text-[10.5px] lg:collapsed:hidden">Ctrl K</kbd><span className="sr-only">Open search</span>
        </button>
        {nav(false)}
        {orgBlock(false)}
      </aside>
      {tip && <div role="tooltip" className="motion-pop pointer-events-none fixed left-[4.5rem] z-[55] -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg shadow-pop" style={{ top: tip.top }}>{tip.label}</div>}

      {/* Mobile drawer */}
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" tabIndex={-1} className="motion-scrim absolute inset-0 bg-black/45" aria-label="Close navigation" onClick={() => setMobile(false)} />
          <div ref={drawer} className="motion-drawer absolute inset-y-0 left-0 flex w-[19rem] max-w-[86vw] flex-col bg-bg shadow-overlay">
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
              <Logo name={productName} />
              <button type="button" onClick={() => setMobile(false)} aria-label="Close navigation" className="grid size-9 place-items-center rounded-md hover:bg-surface-2"><X size={18} aria-hidden /></button>
            </div>
            {nav(true)}
            {orgBlock(true)}
            <div className="border-t border-line p-3"><ThemeToggle /></div>
          </div>
        </div>
      )}

      <div className="min-w-0 lg:pl-[15.5rem] lg:transition-[padding] lg:duration-200 lg:collapsed:pl-16">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-bg shadow-[var(--shadow-nav)] dark:border-b dark:border-line">
          <div className="mx-auto flex h-14 max-w-[105rem] items-center gap-2 px-4 sm:gap-3 lg:px-10 2xl:px-14">
            <button type="button" onClick={() => setMobile(true)} aria-label="Open navigation" aria-expanded={mobile} className="grid size-9 place-items-center rounded-md border border-line bg-surface lg:hidden"><Menu size={17} aria-hidden /></button>
            <span className="lg:hidden"><Logo name={productName} hideText /></span>

            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex">
              {org && (
                <Menu_ label="Organisation" align="left" button={({ open, toggle, ref }) => (
                  <button ref={ref} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-md px-2 font-medium hover:bg-surface-2">
                    <Building2 size={14} className="shrink-0 text-subtle" aria-hidden /><span className="truncate">{org.name}</span><ChevronDown size={13} className="shrink-0 text-subtle" aria-hidden />
                  </button>
                )}>{(close) => (
                  <>
                    <div className="px-2.5 py-2"><p className="text-[13px] font-medium">{org.name}</p><p className="text-[12px] capitalize text-muted">Your role: {role(org.role)}</p></div>
                    <p className="px-2.5 pb-2 text-[12px] leading-relaxed text-subtle">Verac opens your first active organisation. Switching between several is not supported yet.</p>
                    <div className="my-1 h-px bg-line" />
                    <Link role="menuitem" href="/settings/organization" onClick={close} className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] hover:bg-surface-2"><Settings size={14} aria-hidden className="text-subtle" />Organisation settings</Link>
                    <Link role="menuitem" href="/settings/team" onClick={close} className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] hover:bg-surface-2"><Building2 size={14} aria-hidden className="text-subtle" />Team members</Link>
                  </>
                )}</Menu_>
              )}
              {here && <>{org && <span aria-hidden className="text-line-strong">/</span>}<span className="text-muted">{here.section.title}</span><span aria-hidden className="text-line-strong">/</span>
                <Link href={here.item.href} aria-current={path === here.item.href ? "page" : undefined} className="truncate rounded px-1 font-medium hover:bg-surface-2">{here.item.label}</Link>
                {path !== here.item.href && <><span aria-hidden className="text-line-strong">/</span><span className="text-muted">Detail</span></>}</>}
            </nav>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={() => setPalette(true)} aria-label="Search pages and actions" className="grid size-9 place-items-center rounded-md border border-line bg-surface text-muted lg:hidden"><Search size={16} aria-hidden /></button>
              <NetworkPill />
              {account.email && (
                <Link href="/approvals" aria-label={pending ? `${pending} payment request${pending === 1 ? "" : "s"} waiting for approval` : "Approvals: nothing waiting"} title={pending ? `${pending} waiting for approval` : "No approvals waiting"}
                  className="relative grid size-9 place-items-center rounded-md border border-line bg-surface text-muted hover:border-line-strong hover:text-ink">
                  <Bell size={16} aria-hidden />
                  {!!pending && <span aria-hidden className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--warn)] px-1 text-[10.5px] font-semibold text-[var(--surface)]">{pending > 99 ? "99+" : pending}</span>}
                </Link>
              )}
              <span className="hidden sm:block"><ThemeToggle compact /></span>
              {account.configured && (account.email ? (
                <Menu_ label="Account" button={({ open, toggle, ref }) => (
                  <button ref={ref} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
                    className="grid size-9 place-items-center rounded-full bg-surface-3 text-[13px] font-semibold uppercase text-ink ring-1 ring-line hover:ring-line-strong">{account.email!.slice(0, 1)}</button>
                )}>{() => (
                  <>
                    <div className="px-2.5 py-2"><p className="text-[12px] text-muted">Signed in as</p><p className="truncate text-[13px] font-medium">{account.email}</p></div>
                    <div className="my-1 h-px bg-line" />
                    <Link role="menuitem" href="/settings/wallets" className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] hover:bg-surface-2">Wallets</Link>
                    <Link role="menuitem" href="/settings/integrations" className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] hover:bg-surface-2">Integrations</Link>
                    <div className="my-1 h-px bg-line" />
                    <form action="/auth/signout" method="post"><button role="menuitem" type="submit" className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] hover:bg-surface-2"><LogOut size={14} aria-hidden className="text-subtle" />Sign out</button></form>
                  </>
                )}</Menu_>
              ) : (
                <Link href={`/login?next=${encodeURIComponent(path)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-ink hover:bg-primary-hover"><LogIn size={14} aria-hidden />Sign in</Link>
              ))}
            </div>
          </div>
        </header>
        <main id="main" key={path} className="motion-page relative z-[1] mx-auto w-full max-w-[105rem] px-4 pb-16 pt-7 sm:px-6 sm:pt-9 lg:px-10 2xl:px-14">
          {org?.role === "auditor" && (
            <p role="note" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] bg-[var(--tint-sky)] px-4 py-3 text-[14px] text-[var(--tint-ink)]">
              <span className="label-mono">Read-only</span><span>You are signed in as a reviewer. Open anything; the database refuses every change, so nothing here can be altered or paid.</span>
            </p>
          )}
          {here?.section.title === LABS && (
            <p role="note" className="mb-5 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted">
              <span className="font-semibold text-ink">Labs.</span> This module works, but agents do not run it and it has no live on-chain proof yet. The proven core is Invoices, Approvals, Grants, Treasury and Live Proof.
            </p>
          )}
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onClose={closePalette} role={org?.role ?? null} />
    </div>
  );
}
