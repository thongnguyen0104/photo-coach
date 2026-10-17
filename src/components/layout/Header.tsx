import Link from "next/link";
import { Aperture, LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/actions";
import { LocaleSwitcher } from "./LocaleSwitcher";

interface Props {
  user?: { name?: string | null; email?: string | null; image?: string | null };
}

export async function Header({ user }: Props) {
  const t = await getTranslations();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Aperture className="size-6 text-accent" aria-hidden />
          <span>{t("app.name")}</span>
        </Link>

        {user && (
          <nav className="ml-2 hidden items-center gap-1 text-sm sm:flex">
            <Link href="/" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
              {t("nav.analyze")}
            </Link>
            <Link href="/history" className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
              {t("nav.history")}
            </Link>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          {user && (
            <>
              <Link href="/history" className="rounded-lg px-2 py-1.5 text-sm text-muted hover:text-text sm:hidden">
                {t("nav.history")}
              </Link>
              <div className="flex items-center gap-2">
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className="size-8 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-sm font-semibold">
                    {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
                <form action={signOutAction}>
                  <button className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text" title={t("nav.signOut")}>
                    <LogOut className="size-4" aria-hidden />
                    <span className="sr-only">{t("nav.signOut")}</span>
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
