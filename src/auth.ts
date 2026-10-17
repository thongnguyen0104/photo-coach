import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { config } from "@/lib/config";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const db = await getDb();
  const providers: NextAuthConfig["providers"] = [];

  if (config.googleLogin) providers.push(Google);

  // Đăng nhập không cần Google — CHỈ khi chạy local để test (tắt hẳn trên production)
  if (config.devLogin) {
    providers.push(
      Credentials({
        id: "dev",
        name: "Dev login",
        credentials: { name: { label: "Name", type: "text" } },
        async authorize(creds) {
          const name = String(creds?.name || "Dev User").slice(0, 40);
          const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "dev"}@local.test`;
          const [existing] = await db.select().from(users).where(eq(users.email, email));
          if (existing) return existing;
          const [created] = await db.insert(users).values({ name, email }).returning();
          return created;
        },
      }),
    );
  }

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers,
    // JWT: bắt buộc khi có Credentials provider; cũng nhẹ hơn cho DB miễn phí
    session: { strategy: "jwt" },
    trustHost: true,
    pages: { signIn: "/" },
    callbacks: {
      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
});
