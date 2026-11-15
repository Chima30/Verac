"use client";
import { useEffect, useRef } from "react";

/**
 * A quiet field of small dots that drift and join with fine lines when they come close.
 * One canvas, fixed behind the page content; cards are opaque, so it shows only in the open space around them.
 *
 * Performance: dot count scales with the area and is capped, pixel ratio is capped at 2, the loop stops while the
 * tab is hidden, and the canvas never takes pointer events. Reduced motion draws one still frame and stops.
 * Colours come from the theme tokens, so it follows light and dark mode.
 */
export function Constellation({ className = "", density = 1 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    type Dot = { x: number; y: number; vx: number; vy: number; r: number };
    let dots: Dot[] = [];
    let w = 0, h = 0, raf = 0, running = false;
    let dotColor = "", lineRgb = "";
    const LINK = 130; // px within which two dots are joined

    const readColors = () => {
      const cs = getComputedStyle(canvas);
      const dark = document.documentElement.classList.contains("dark") && !canvas.closest(".theme-light");
      dotColor = dark ? "rgba(255,255,255,0.32)" : "rgba(9,9,11,0.22)";
      // Lines take the accent hue so the field reads as Verac's, very faintly.
      const accent = cs.getPropertyValue("--accent").trim() || (dark ? "#2dd4bf" : "#0f9488");
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent);
      lineRgb = m ? `${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)}` : dark ? "45,212,191" : "15,148,136";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(90, Math.round(((w * h) / 16000) * density));
      while (dots.length < target) dots.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22, r: Math.random() * 1.3 + 0.7 });
      dots.length = target;
      for (const d of dots) { d.x = Math.min(d.x, w); d.y = Math.min(d.y, h); }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i]!;
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j]!;
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const o = (1 - Math.sqrt(d2) / LINK) * 0.28;
            ctx.strokeStyle = `rgba(${lineRgb},${o.toFixed(3)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = dotColor;
      for (const d of dots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); }
    };

    const step = () => {
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < -10) d.x = w + 10; else if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10; else if (d.y > h + 10) d.y = -10;
      }
      draw();
      raf = requestAnimationFrame(step);
    };

    const start = () => { if (running || reduce.matches || document.hidden) return; running = true; raf = requestAnimationFrame(step); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    readColors(); resize(); draw(); start();

    const ro = new ResizeObserver(() => { resize(); if (!running) draw(); });
    ro.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const onMotion = () => { if (reduce.matches) { stop(); draw(); } else start(); };
    reduce.addEventListener("change", onMotion);
    // Theme switches change the class on <html>; repaint in the new colours.
    const mo = new MutationObserver(() => { readColors(); if (!running) draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => { stop(); ro.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", onVis); reduce.removeEventListener("change", onMotion); };
  }, [density]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none ${className}`} />;
}
