"use client";

import { useTranslations } from "next-intl";
import { Ruler } from "lucide-react";
import type { Fact } from "@/lib/analysis/types";

const DOT: Record<string, string> = {
  positive: "bg-good",
  info: "bg-info",
  low: "bg-muted",
  medium: "bg-warn",
  high: "bg-bad",
};

export function FactsList({ facts }: { facts: Fact[] }) {
  const t = useTranslations();
  // Key động (fact.<id>) → bỏ kiểm tra kiểu tham số
  const tDynamic = t as unknown as (key: string, values: Record<string, string | number>) => string;
  return (
    <section className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Ruler className="size-5 text-accent" aria-hidden />
        {t("result.facts")}
      </h2>
      <ul className="space-y-2 text-sm">
        {facts.map((f) => {
          const values = { ...f.values };
          if (typeof values.region === "string" && t.has(`regions.${values.region}`)) {
            values.region = t(`regions.${values.region}` as never);
          }
          return (
            <li key={f.id} className="flex items-start gap-2.5">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[f.severity]}`} title={t(`severity.${f.severity}`)} />
              <span>{t.has(`fact.${f.id}`) ? tDynamic(`fact.${f.id}`, values) : f.id}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
