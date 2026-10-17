"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { CheckCircle2, FlaskConical, Lightbulb, Sparkles } from "lucide-react";
import type { AnalysisResult, Fact } from "@/lib/analysis/types";
import type { NormalizedMetadata, RawMetadata } from "@/lib/image/metadata";
import type { ImageStats } from "@/lib/image/stats";
import { PhotoOverlay } from "./PhotoOverlay";
import { AnalysisActions, type AnalysisActionsProps } from "./AnalysisActions";
import { ScoreRing, scoreColor } from "./ScoreBadge";
import { Histogram } from "./Histogram";
import { ExifPanel } from "./ExifPanel";
import { FactsList } from "./FactsList";
import { SettingsPanel } from "./SettingsPanel";

export interface ResultViewProps {
  result: AnalysisResult;
  facts: Fact[];
  stats: ImageStats;
  metadata: NormalizedMetadata;
  rawMetadata: RawMetadata | null;
  photo: { width: number; height: number; fileName: string; mime: string; sizeBytes: number; previewUrl: string; gpsSaved: boolean };
  info: { mode: string; provider: string; locale: string; currentLocale: string };
  actions: AnalysisActionsProps;
}

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-bad text-white",
  medium: "bg-warn text-white",
  low: "bg-surface-2 text-muted",
};

export function ResultView({ result, facts, stats, metadata, rawMetadata, photo, info, actions }: ResultViewProps) {
  const t = useTranslations();
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Cột trái: ảnh + lớp đánh dấu (dính khi cuộn trên desktop) */}
      <div className="space-y-4 self-start lg:sticky lg:top-20">
        <PhotoOverlay
          src={photo.previewUrl}
          width={photo.width}
          height={photo.height}
          result={result}
          activeId={activeId}
          onActivate={setActiveId}
        />
        <AnalysisActions {...actions} />
      </div>

      {/* Cột phải: nhận xét */}
      <div className="space-y-8">
        {info.provider === "mock" && (
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-muted">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            {t("result.mockNotice")}
          </p>
        )}

        <section className="card space-y-5 p-5">
          <div className="flex items-center gap-5">
            <ScoreRing score={result.overallScore} label={t("result.overall")} />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-full bg-surface-2 px-2 py-0.5">{t(`result.genre.${result.genre}`)}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("result.modeLabel", { mode: info.mode })}</span>
              </div>
              <h1 className="text-lg leading-snug font-bold text-pretty">{result.headline}</h1>
            </div>
          </div>
          <p className="leading-relaxed">{result.summary}</p>
          {result.scores.length > 0 && (
            <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {result.scores.map((s) => (
                <li key={s.category} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{t(`category.${s.category}`)}</span>
                    <span className="font-semibold tabular-nums">{s.score}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${s.score}%`, background: scoreColor(s.score) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {result.strengths.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">{t("result.strengths")}</h2>
            <ul className="space-y-3">
              {result.strengths.map((s, i) => (
                <li key={i} className="card flex gap-3 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good" aria-hidden />
                  <div className="space-y-1">
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-sm leading-relaxed">{s.detail}</p>
                    {s.evidence && s.evidence !== "—" && <p className="text-xs text-muted">{s.evidence}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.improvements.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">{t("result.improvements")}</h2>
            <ol className="space-y-3">
              {result.improvements.map((imp) => (
                <li
                  key={imp.id}
                  id={`imp-${imp.id}`}
                  data-testid="improvement"
                  onMouseEnter={() => setActiveId(imp.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onClick={() => setActiveId((a) => (a === imp.id ? null : imp.id))}
                  className={clsx("card scroll-mt-24 space-y-2 p-4 transition-colors", activeId === imp.id && "border-accent ring-1 ring-accent")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-text text-xs font-bold text-bg">{imp.n}</span>
                    <p className="font-semibold">{imp.title}</p>
                    <span className="ml-auto flex gap-1.5 text-[11px] font-medium">
                      <span className="rounded-full bg-surface-2 px-2 py-0.5">{t(`category.${imp.category}`)}</span>
                      <span className={clsx("rounded-full px-2 py-0.5", SEVERITY_STYLE[imp.severity])}>{t(`severity.${imp.severity}`)}</span>
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">
                    <Sparkles className="mr-1 inline size-3.5 text-good" aria-hidden />
                    {imp.praiseFirst} {imp.suggestion}
                  </p>
                  <div className="rounded-lg bg-surface-2 p-3 text-sm">
                    <span className="font-semibold">{t("result.howTo")}: </span>
                    {imp.howTo}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {result.nextShotTips.length > 0 && (
          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Lightbulb className="size-5 text-accent" aria-hidden />
              {t("result.nextShot")}
            </h2>
            <ol className="list-decimal space-y-1.5 pl-5">
              {result.nextShotTips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ol>
          </section>
        )}

        {result.suggestedSettings && <SettingsPanel settings={result.suggestedSettings} />}
        {facts.length > 0 && <FactsList facts={facts} />}
        <Histogram stats={stats} />
        <ExifPanel metadata={metadata} raw={rawMetadata} photo={photo} />
      </div>
    </div>
  );
}
