"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Download, Languages, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import Link from "next/link";

export interface AnalysisActionsProps {
  photoId: string;
  mode: "basic" | "advanced";
  analysisLocale: string;
  originalUrl: string;
  fileName: string;
}

export function AnalysisActions({ photoId, mode, analysisLocale, originalUrl, fileName }: AnalysisActionsProps) {
  const t = useTranslations("result");
  const tErr = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reanalyze(nextMode: "basic" | "advanced", key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId, locale, mode: nextMode }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(`/analyze/${json.analysisId}`);
      router.refresh();
    } else {
      setError(json.error ?? "server_error");
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(t("deleteConfirm"))) return;
    setBusy("delete");
    await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    router.push("/history");
    router.refresh();
  }

  const otherMode = mode === "basic" ? "advanced" : "basic";
  const spin = (key: string, Icon: typeof RefreshCw) =>
    busy === key ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" aria-hidden />;

  return (
    <div className="space-y-3">
      {analysisLocale !== locale && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span>{t("otherLocale", { lang: analysisLocale })}</span>
          <button type="button" className="btn btn-ghost py-1.5" disabled={!!busy} onClick={() => reanalyze(mode, "locale")}>
            {spin("locale", Languages)}
            {t("reanalyzeLocale")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/" className="btn btn-primary">
          <Upload className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => reanalyze(otherMode, "mode")}>
          {spin("mode", RefreshCw)}
          {t("reanalyze", { mode: otherMode })}
        </button>
        <a href={originalUrl} download={fileName} target="_blank" rel="noreferrer" className="btn btn-ghost">
          <Download className="size-4" aria-hidden />
          {t("download")}
        </a>
        <button type="button" className="btn btn-ghost text-bad" disabled={!!busy} onClick={remove}>
          {spin("delete", Trash2)}
          {t("delete")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {tErr(error as never)}
        </p>
      )}
    </div>
  );
}
