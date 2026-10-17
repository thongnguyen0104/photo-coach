import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getOwnedAnalysis } from "@/lib/server/photos";
import { PhotoEditor } from "@/components/editor/PhotoEditor";

export async function generateMetadata() {
  const t = await getTranslations("editor");
  return { title: t("title") };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await getOwnedAnalysis(await getDb(), session.user.id, id);
  if (!data) notFound();
  const { analysis, photo, meta } = data;

  const storage = await getStorage();
  // Link ảnh gốc dùng 2 giờ — đủ cho một phiên chỉnh sửa
  const originalUrl = await storage.presignGet(photo.originalKey, 7200);

  return (
    <PhotoEditor
      analysisId={analysis.id}
      originalUrl={originalUrl}
      mime={photo.mime}
      fileName={photo.fileName}
      width={photo.width}
      height={photo.height}
      result={analysis.status === "done" ? analysis.result : null}
      stats={meta.stats}
      objectRemoval={config.objectRemoval}
    />
  );
}
