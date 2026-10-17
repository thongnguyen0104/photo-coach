"use client";

import { useTranslations } from "next-intl";
import type { ImageStats } from "@/lib/image/stats";

function path(bins: number[], max: number, closed: boolean) {
  const w = 256 / bins.length;
  const pts = bins.map((v, i) => `${(i + 0.5) * w},${100 - (v / max) * 96}`);
  return closed ? `M0,100 L${pts.join(" L")} L256,100 Z` : `M${pts.join(" L")}`;
}

export function Histogram({ stats }: { stats: ImageStats }) {
  const t = useTranslations("result");
  const { luma, r, g, b } = stats.histogram;
  // Bỏ 2 bin đầu/cuối khi tính max để cột cháy sáng không đè bẹp phần còn lại
  const max = Math.max(...luma.slice(1, -1), ...r.slice(1, -1), ...g.slice(1, -1), ...b.slice(1, -1), 1e-6);
  const hi = (stats.clippedHighlights * 100).toFixed(1);
  const lo = (stats.clippedShadows * 100).toFixed(1);

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-lg font-bold">{t("histogram")}</h2>
      <svg viewBox="0 0 256 100" preserveAspectRatio="none" className="h-28 w-full rounded-lg bg-surface-2" role="img" aria-label={t("histogram")}>
        <path d={path(luma, max, true)} fill="var(--muted)" opacity={0.35} />
        <path d={path(r, max, false)} fill="none" stroke="#ef4444" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8} />
        <path d={path(g, max, false)} fill="none" stroke="#22c55e" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8} />
        <path d={path(b, max, false)} fill="none" stroke="#3b82f6" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.8} />
      </svg>
      <div className="flex justify-between text-xs text-muted">
        <span>{t("clippedLo", { percent: lo })}</span>
        <span>{t("clippedHi", { percent: hi })}</span>
      </div>
    </section>
  );
}
