import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getOwnedAnalysis } from "@/lib/server/photos";
import { expireStaleAnalysis } from "@/lib/server/analyze";
import { storedErrorCode } from "@/lib/server/errors";
import { ResultView } from "@/components/result/ResultView";
import { AnalysisActions } from "@/components/result/AnalysisActions";
import { PendingRefresh } from "@/components/result/PendingRefresh";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("analyze") };
}

export default async function AnalyzePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await getDb();
  let data = await getOwnedAnalysis(db, session.user.id, id);
  if (!data) notFound();
  // Treo quá lâu (server bị dừng giữa chừng) → chuyển sang lỗi + hoàn lượt
  if (data.analysis.status === "pending" && (await expireStaleAnalysis(db, id))) {
    data = (await getOwnedAnalysis(db, session.user.id, id))!;
  }
  const { analysis, photo, meta } = data;

  const [t, tErr, locale, storage] = await Promise.all([getTranslations("result"), getTranslations("errors"), getLocale(), getStorage()]);
  const [previewUrl, originalUrl] = await Promise.all([storage.presignGet(photo.previewKey), storage.presignGet(photo.originalKey)]);
  const actions = { analysisId: analysis.id, photoId: photo.id, mode: analysis.mode, analysisLocale: analysis.locale, originalUrl, fileName: photo.fileName };

  if (analysis.status !== "done" || !analysis.result) {
    const failed = analysis.status === "failed";
    return (
      <div className="card mx-auto max-w-xl space-y-4 p-6">
        {failed ? (
          <p role="alert" className="text-bad">
            {t("failed", { error: tErr(storedErrorCode(analysis.error)) })}
          </p>
        ) : (
          <p role="status" className="flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("pending")}
            <PendingRefresh />
          </p>
        )}
        <AnalysisActions {...actions} status={failed ? "failed" : "pending"} />
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
