"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { ScoreBadge } from "@/components/result/ScoreBadge";

export interface HistoryCard {
  photoId: string;
  analysisId: string;
  fileName: string;
  overallScore: number | null;
  headline: string | null;
  createdAt: Date;
  previewUrl: string;
}

export function HistoryGrid({ items, deletable = false }: { items: HistoryCard[]; deletable?: boolean }) {
  const t = useTranslations("result");
  const tErr = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(photoId: string) {
    if (!confirm(t("deleteConfirm"))) return;
    setDeleting(photoId);
    const res = await fetch(`/api/photos/${photoId}`, { method: "DELETE" }).catch(() => null);
    setDeleting(null);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => ({}))).error ?? "server_error") : "upload_failed";
      alert(tErr(code));
      return;
    }
    router.refresh();
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.photoId} className="card group relative overflow-hidden" data-testid="history-item">
          <Link href={`/analyze/${item.analysisId}`} className="block">
            <div className="relative aspect-[4/3] bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt={item.fileName} className="size-full object-cover" loading="lazy" />
              {item.overallScore != null && (
                <ScoreBadge score={item.overallScore} className="absolute top-2 left-2" />
              )}
            </div>
            <div className="space-y-0.5 p-3">
              <p className="line-clamp-2 text-sm font-medium">{item.headline ?? item.fileName}</p>
              <p className="text-xs text-muted">{format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })}</p>
            </div>
          </Link>
          {deletable && (
            <button
              type="button"
              onClick={() => remove(item.photoId)}
              disabled={deleting === item.photoId}
              className="absolute top-2 right-2 rounded-lg bg-bg/80 p-1.5 text-muted opacity-100 hover:text-bad sm:opacity-0 sm:group-hover:opacity-100"
              title={t("delete")}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">{t("delete")}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
