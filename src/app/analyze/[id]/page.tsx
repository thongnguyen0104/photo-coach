import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getOwnedAnalysis } from "@/lib/server/photos";
import { ResultView } from "@/components/result/ResultView";
import { AnalysisActions } from "@/components/result/AnalysisActions";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("analyze") };
}

export default async function AnalyzePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await getOwnedAnalysis(await getDb(), session.user.id, id);
  if (!data) notFound();
  const { analysis, photo, meta } = data;

  const [t, locale, storage] = await Promise.all([getTranslations("result"), getLocale(), getStorage()]);
  const [previewUrl, originalUrl] = await Promise.all([storage.presignGet(photo.previewKey), storage.presignGet(photo.originalKey)]);
  const actions = { photoId: photo.id, mode: analysis.mode, analysisLocale: analysis.locale, originalUrl, fileName: photo.fileName };

  if (analysis.status !== "done" || !analysis.result) {
    return (
      <div className="card mx-auto max-w-xl space-y-4 p-6">
        <p role="alert" className={analysis.status === "failed" ? "text-bad" : "text-muted"}>
          {analysis.status === "failed" ? t("failed", { error: analysis.error ?? "?" }) : t("pending")}
        </p>
        <AnalysisActions {...actions} />
      </div>
    );
  }

  return (
    <ResultView
      result={analysis.result}
      facts={analysis.facts ?? []}
      stats={meta.stats}
      metadata={meta.normalized}
      rawMetadata={meta.raw}
      photo={{
        width: photo.width,
        height: photo.height,
        fileName: photo.fileName,
        mime: photo.mime,
        sizeBytes: photo.sizeBytes,
        previewUrl,
        gpsSaved: meta.gpsLat != null,
      }}
      info={{ mode: analysis.mode, provider: analysis.provider, locale: analysis.locale, currentLocale: locale }}
      actions={actions}
    />
  );
}
