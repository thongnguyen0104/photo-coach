"use client";

import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis/types";

export function SettingsPanel({ settings }: { settings: NonNullable<AnalysisResult["suggestedSettings"]> }) {
  const t = useTranslations("result");
  const cells = [
    ["aperture", settings.aperture],
    ["shutter", settings.shutter],
    ["iso", settings.iso],
    ["ev", settings.exposureCompensation],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <section className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <SlidersHorizontal className="size-5 text-accent" aria-hidden />
        {t("settings")}
        {settings.hdr && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-fg">{t("hdrOn")}</span>}
      </h2>
      {cells.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {cells.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-surface-2 p-2.5">
              <dt className="text-xs text-muted">{t(key as "aperture")}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {settings.editing && settings.editing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">{t("editing")}:</span>
          {settings.editing.map((e) => (
            <span key={e} className="rounded-md border border-border px-2 py-0.5 font-mono text-xs">
              {e}
            </span>
          ))}
        </div>
      )}
      {settings.notes && <p className="text-sm leading-relaxed text-muted">{settings.notes}</p>}
    </section>
  );
}
