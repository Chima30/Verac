"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/** Light, dark or follow the system. The choice is stored by next-themes under "verac-theme". */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme ?? "system" : "system";
  return (
    <div role="radiogroup" aria-label="Colour theme" className={`inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 ${compact ? "" : "w-full"}`}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = mounted && current === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={on} aria-label={`${label} theme`} title={label} onClick={() => setTheme(value)}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] ${on ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
            <Icon size={14} aria-hidden />{!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
