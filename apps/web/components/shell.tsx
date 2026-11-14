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
          <p className="type-micro px-2 pb-2 text-text-2">{s.title}</p>
          <ul className="space-y-0.5">
            {s.items.map(({ href, label, icon: Icon }) => {
              const active = path === href;
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined}
                    className={`type-label flex h-8 items-center gap-2 px-2 ${active ? "selected" : "text-text-2 hover:bg-hover hover:text-text-1"}`}>
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
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-panel lg:flex">
        <div className="type-heading flex h-14 items-center px-5">{productName}</div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-panel shadow-xl">
            <div className="flex h-14 items-center justify-between px-5"><span className="font-medium">{productName}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="h-8 w-8 rounded-md hover:bg-hover"><X size={18} className="mx-auto" /></button></div>
            {nav}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-page px-4 lg:px-8">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line lg:hidden"><Menu size={18} /></button>
          <p className="type-micro hidden text-text-2 sm:block">QoreChain Diana testnet · chain 9800 · mainnet disabled</p>
          <div className="ml-auto flex items-center gap-2">
            {account.configured && (account.email ? (
              <form action="/auth/signout" method="post" className="flex items-center gap-2">
                <span className="hidden max-w-[12rem] truncate text-xs text-text-2 sm:inline">{account.email}</span>
                <button type="submit" className="edged type-label inline-flex h-8 items-center px-3">Sign out</button>
              </form>
            ) : (
              <Link href="/login" className="edged type-label inline-flex h-8 items-center px-3">Sign in</Link>
            ))}
            <ThemeToggle />
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
