import { FlaskConical } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function LocalModeBanner({ services }: { services: string[] }) {
  const t = await getTranslations("localMode");
  return (
    <div className="border-b border-border bg-surface-2 text-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
        <FlaskConical className="size-4 text-warn" aria-hidden />
        <strong>{t("title")}:</strong>
        <span>{services.map((s) => t(s as "database" | "storage" | "ai")).join(" · ")}.</span>
        <span className="text-muted">{t("hint")}</span>
      </div>
    </div>
  );
}
