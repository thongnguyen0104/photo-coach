// Áp migration trong ./drizzle vào database.
//   - Có DATABASE_URL → Neon
//   - Không có        → PGlite local (.data/pglite)
// Chạy: npm run db:migrate   (Vercel tự chạy qua script vercel-build)
import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    await migrate(drizzle({ client: neon(url) }), { migrationsFolder: "drizzle" });
    console.log("✔ Đã migrate Neon");
  } else {
    if (process.env.VERCEL) throw new Error("Thiếu DATABASE_URL trên Vercel");
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = process.env.PGLITE_DIR || ".data/pglite";
    fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    await client.close();
    console.log(`✔ Đã migrate PGlite local (${dir})`);
  }
}

main().catch((err) => {
  console.error("✘ Migrate lỗi:", err.message);
  process.exit(1);
});
