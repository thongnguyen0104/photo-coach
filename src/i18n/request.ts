import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["vi", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "NEXT_LOCALE";

// Ngôn ngữ lưu trong cookie (không đổi URL) — mặc định tiếng Việt
export default getRequestConfig(async () => {
  const store = await cookies();
  const locale: AppLocale = store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "vi";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
