import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { config } from "@/lib/config";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

async function createDb(): Promise<Db> {
  if (config.database === "neon") {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    return drizzle({ client: neon(process.env.DATABASE_URL!), schema }) as unknown as Db;
  }
  // Chế độ local: Postgres nhúng (PGlite), dữ liệu lưu ở .data/pglite
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(process.env.PGLITE_DIR || ".data/pglite");
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

let pending: Promise<Db> | undefined;

/** Lấy kết nối DB (tạo 1 lần, dùng chung cho cả process). */
export async function getDb(): Promise<Db> {
  if (globalForDb.__db) return globalForDb.__db;
  pending ??= createDb().then((db) => (globalForDb.__db = db));
  return pending;
}

export { schema };
