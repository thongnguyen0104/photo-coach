"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import clsx from "clsx";
import { setLocale } from "@/app/actions";

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const [pending, start] = useTransition();

  return (
    <div role="group" aria-label={t("language")} className={clsx("flex rounded-lg border border-border p-0.5 text-xs font-semibold", pending && "opacity-60")}>
      {(["vi", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          disabled={pending}
          onClick={() => start(() => setLocale(l))}
          className={clsx("rounded-md px-2 py-1 uppercase", locale === l ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
