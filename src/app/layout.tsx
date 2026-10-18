import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { localModeServices } from "@/lib/config";
import { Header } from "@/components/layout/Header";
import { LocalModeBanner } from "@/components/layout/LocalModeBanner";
import Link from "next/link";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: `${t("name")} — ${t("tagline")}`, template: `%s · ${t("name")}` },
    description: t("description"),
    // Mở từ Màn hình chính trên iPhone → chạy toàn màn hình như app
    appleWebApp: { capable: true, title: t("name"), statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  // Cho phép màn hình camera tràn viền (dùng env(safe-area-inset-*) để tránh tai thỏ)
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, session, t] = await Promise.all([getLocale(), auth(), getTranslations("nav")]);
  const local = localModeServices();

  return (
    <html lang={locale} className={`${font.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>
          <Header user={session?.user} />
          {local.length > 0 && <LocalModeBanner services={local} />}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">{children}</main>
          <footer className="border-t border-border py-6 text-center text-sm text-muted">
            <Link href="/privacy" className="hover:text-text">
              {t("privacy")}
            </Link>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
