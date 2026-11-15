"use client";
import { ArrowRight, CornerDownLeft, Monitor, Moon, Search, Sun, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ACTIONS, NAV } from "@/lib/nav";

interface Entry { id: string; group: string; label: string; hint?: string; keywords: string; icon: ReactNode; run: () => void }

/** Scores a query against a label and keywords: prefix and word-start matches rank above substrings. 0 means no match. */
function score(q: string, e: Entry): number {
  if (!q) return 1;
  const label = e.label.toLowerCase();
  const all = `${label} ${e.keywords} ${e.group.toLowerCase()}`;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const t of terms) {
    if (label.startsWith(t)) s += 4;
    else if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(all)) s += 2;
    else if (all.includes(t)) s += 1;
    else return 0;
  }
  return s;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const t = q.trim().split(/\s+/)[0]?.toLowerCase();
  if (!t) return <>{text}</>;
  const i = text.toLowerCase().indexOf(t);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded-[3px] bg-accent-soft px-px text-accent-text">{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
}

export function CommandPalette({ open, onClose, role }: { open: boolean; onClose: () => void; role: string | null }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const lid = useId();

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => { onClose(); router.push(href); };
    const pages: Entry[] = NAV.flatMap((s) => s.items.map(({ href, label, icon: Icon, keywords }) => ({
      id: `p:${href}`, group: "Pages", label, hint: s.title, keywords: keywords ?? "", icon: <Icon size={16} aria-hidden />, run: go(href),
    })));
    // Only actions this role may take. The page enforces the same rule again on the server.
    const actions: Entry[] = ACTIONS.filter((a) => a.allowed(role)).map((a) => ({
      id: `a:${a.id}`, group: "Actions", label: a.label, keywords: a.keywords, icon: <Zap size={16} aria-hidden />, run: go(a.href),
    }));
    const theme: Entry[] = [
      { id: "t:light", group: "Preferences", label: "Use light theme", keywords: "theme appearance", icon: <Sun size={16} aria-hidden />, run: () => { setTheme("light"); onClose(); } },
      { id: "t:dark", group: "Preferences", label: "Use dark theme", keywords: "theme appearance", icon: <Moon size={16} aria-hidden />, run: () => { setTheme("dark"); onClose(); } },
      { id: "t:system", group: "Preferences", label: "Match system theme", keywords: "theme appearance auto", icon: <Monitor size={16} aria-hidden />, run: () => { setTheme("system"); onClose(); } },
    ];
    return [...actions, ...pages, ...theme];
  }, [role, router, onClose, setTheme]);

  const results = useMemo(() => {
    const scored = entries.map((e) => ({ e, s: score(q.trim(), e) })).filter((x) => x.s > 0);
    if (q.trim()) scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.e);
  }, [entries, q]);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    setQ(""); setActive(0);
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => { clearTimeout(t); restore.current?.focus?.(); };
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); results[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "Tab") { e.preventDefault(); } // focus stays in the dialog
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search and jump">
      <button type="button" aria-label="Close search" tabIndex={-1} onClick={onClose} className="motion-scrim absolute inset-0 cursor-default bg-black/45 backdrop-blur-[1px]" />
      <div className="motion-pop relative w-full max-w-[36rem] overflow-hidden rounded-xl border border-line bg-surface shadow-overlay" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-subtle" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages and actions…" aria-label="Search pages and actions"
            role="combobox" aria-expanded="true" aria-controls={lid} aria-activedescendant={results[active] ? `${lid}-${active}` : undefined} aria-autocomplete="list"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-subtle focus-visible:outline-none" />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-subtle sm:block">Esc</kbd>
        </div>
        <ul ref={list} id={lid} role="listbox" aria-label="Results" className="scroll-quiet max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-8 text-center text-[13.5px] text-muted">Nothing matches “{q}”. Try a page name, like “treasury”, or a verb, like “approve”.</li>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null; lastGroup = r.group;
            return (
              <li key={r.id} role="presentation">
                {head && <p role="presentation" className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-medium text-subtle">{head}</p>}
                <div id={`${lid}-${i}`} role="option" aria-selected={i === active} data-index={i}
                  onMouseMove={() => setActive(i)} onClick={() => r.run()}
                  className={`flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13.5px] ${i === active ? "bg-surface-2 text-ink" : "text-ink/90"}`}>
                  <span className={i === active ? "text-accent-text" : "text-subtle"}>{r.icon}</span>
                  <span className="min-w-0 flex-1 truncate"><Highlight text={r.label} q={q} /></span>
                  {r.hint && <span className="text-[12px] text-subtle">{r.hint}</span>}
                  {i === active && (r.group === "Preferences" ? <CornerDownLeft size={14} className="text-subtle" aria-hidden /> : <ArrowRight size={14} className="text-subtle" aria-hidden />)}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11.5px] text-subtle">
          <span><kbd className="font-mono">↑↓</kbd> move</span><span><kbd className="font-mono">Enter</kbd> open</span>
          <span className="ml-auto">{role ? `Showing actions allowed for ${role.replaceAll("_", " ")}` : "Sign in to see actions"}</span>
        </div>
      </div>
    </div>
  );
}
