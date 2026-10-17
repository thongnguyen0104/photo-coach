import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  const items = t.raw("items") as string[];
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <ShieldCheck className="size-7 text-accent" aria-hidden />
        {t("title")}
      </h1>
      <ul className="card space-y-4 p-6">
        {items.map((text) => (
          <li key={text} className="flex gap-3 leading-relaxed">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            {text}
          </li>
        ))}
      </ul>
    </article>
  );
}
