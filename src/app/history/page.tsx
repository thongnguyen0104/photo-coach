import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { listHistory } from "@/lib/server/photos";
import { HistoryGrid } from "@/components/history/HistoryGrid";

export async function generateMetadata() {
  const t = await getTranslations("history");
  return { title: t("title") };
}

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const t = await getTranslations("history");

  const history = await listHistory(await getDb(), session.user.id);
  const storage = await getStorage();
  const items = await Promise.all(history.map(async (h) => ({ ...h, previewUrl: await storage.presignGet(h.previewKey) })));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {items.length === 0 ? (
        <div className="card space-y-4 p-10 text-center">
          <p className="text-muted">{t("empty")}</p>
          <Link href="/" className="btn btn-primary">
            {t("start")}
          </Link>
        </div>
      ) : (
        <HistoryGrid items={items} deletable />
      )}
    </div>
  );
}
