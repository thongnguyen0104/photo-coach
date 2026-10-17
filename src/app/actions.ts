"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/auth";
import { LOCALE_COOKIE, type AppLocale } from "@/i18n/request";

export async function setLocale(locale: AppLocale) {
  (await cookies()).set(LOCALE_COOKIE, locale === "en" ? "en" : "vi", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signInDev(formData: FormData) {
  await signIn("dev", { name: String(formData.get("name") || "Dev User"), redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
