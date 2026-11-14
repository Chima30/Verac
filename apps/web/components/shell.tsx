"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV } from "@/lib/nav";
import { ThemeToggle } from "./theme-toggle";

export function Shell({ productName, account, children }: { productName: string; account: { configured: boolean; email: string | null }; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
      {NAV.map((s) => (
        <div key={s.title} className="mt-6 first:mt-2">
          <p className="px-2 pb-2 text-xs text-muted">{s.title}</p>
          <ul className="space-y-0.5">
            {s.items.map(({ href, label, icon: Icon }) => {
              const active = path === href;
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined}
                    className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm ${active ? "bg-surface-2 font-medium text-ink shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                    <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" /> {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center px-5 text-base font-medium tracking-tight">{productName}</div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between px-5"><span className="font-medium">{productName}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="h-8 w-8 rounded-md hover:bg-surface-2"><X size={18} className="mx-auto" /></button></div>
            {nav}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg px-4 lg:px-8">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line lg:hidden"><Menu size={18} /></button>
          <p className="hidden text-xs text-muted sm:block">QoreChain Diana testnet · chain 9800 · mainnet disabled</p>
          <div className="ml-auto flex items-center gap-2">
            {account.configured && (account.email ? (
              <form action="/auth/signout" method="post" className="flex items-center gap-2">
                <span className="hidden max-w-[12rem] truncate text-xs text-muted sm:inline">{account.email}</span>
                <button type="submit" className="rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2">Sign out</button>
              </form>
            ) : (
              <Link href="/login" className="rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2">Sign in</Link>
            ))}
            <ThemeToggle />
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
