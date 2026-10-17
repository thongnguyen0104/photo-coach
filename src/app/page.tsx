import Link from "next/link";
import { Crop, Grid3x3, SlidersHorizontal, SunMedium } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUsage } from "@/lib/server/quota";
import { listHistory } from "@/lib/server/photos";
import { signInDev, signInWithGoogle } from "@/app/actions";
import { Uploader } from "@/components/upload/Uploader";
import { HistoryGrid } from "@/components/history/HistoryGrid";

export default async function HomePage() {
  const session = await auth();
  return session?.user?.id ? <Workspace userId={session.user.id} /> : <Landing />;
}

async function Workspace({ userId }: { userId: string }) {
  const t = await getTranslations("home");
  const db = await getDb();
  const [used, history] = await Promise.all([getUsage(db, userId), listHistory(db, userId, 4)]);
  const storage = await getStorage();
  const items = await Promise.all(history.map(async (h) => ({ ...h, previewUrl: await storage.presignGet(h.previewKey) })));
  const limit = config.dailyQuota;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-2xl font-bold sm:text-3xl">{t("heroTitle")}</h1>
          <p className="text-sm text-muted" data-testid="quota">
            {t("quota", { remaining: Math.max(0, limit - used), limit })}
          </p>
        </div>
        <Uploader />
      </section>

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("recent")}</h2>
            <Link href="/history" className="text-sm text-accent hover:underline">
              {t("seeAll")}
            </Link>
          </div>
          <HistoryGrid items={items} />
        </section>
      )}
    </div>
  );
}

async function Landing() {
  const t = await getTranslations("home");
  const features = [
    { key: "composition", Icon: Grid3x3 },
    { key: "crop", Icon: Crop },
    { key: "light", Icon: SunMedium },
    { key: "settings", Icon: SlidersHorizontal },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-12 py-6 text-center">
      <section className="space-y-5">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">{t("heroTitle")}</h1>
        <p className="mx-auto max-w-2xl text-lg text-muted text-pretty">{t("heroSubtitle")}</p>

        <div className="flex flex-col items-center gap-4 pt-2">
          {config.googleLogin && (
            <form action={signInWithGoogle}>
              <button className="btn btn-primary px-6 py-3 text-base">
                <GoogleIcon />
                {t("signInGoogle")}
              </button>
            </form>
          )}
          {config.devLogin && (
            <form action={signInDev} className="card flex w-full max-w-sm flex-col gap-2 p-4 text-left">
              <label htmlFor="dev-name" className="text-sm font-semibold">
                {t("devLoginTitle")}
              </label>
              <div className="flex gap-2">
                <input
                  id="dev-name"
                  name="name"
                  defaultValue="Dev User"
                  aria-label={t("devLoginName")}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                />
                <button className="btn btn-ghost">{t("devLoginButton")}</button>
              </div>
            </form>
          )}
          {!config.googleLogin && !config.devLogin && <p className="text-bad">{t("noLoginMethod")}</p>}
        </div>
      </section>

      <section className="grid gap-4 text-left sm:grid-cols-2">
        {features.map(({ key, Icon }) => (
          <div key={key} className="card flex gap-3 p-5">
            <Icon className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
            <div>
              <h2 className="font-semibold">{t(`features.${key}.title`)}</h2>
              <p className="text-sm text-muted">{t(`features.${key}.text`)}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 rounded-full bg-white p-0.5" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.4-.4-2s.1-1.4.4-2V7.1H2A11 11 0 0 0 1 12c0 1.8.4 3.5 1.2 4.9L5.7 14Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10c.9-2.7 3.4-4.6 6.3-4.6Z" />
    </svg>
  );
}
