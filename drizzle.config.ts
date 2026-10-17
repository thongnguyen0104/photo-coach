import fs from "node:fs";
import { defineConfig } from "drizzle-kit";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

// Chỉ dùng cho `npm run db:generate` (sinh file SQL migration từ src/lib/db/schema.ts).
// Áp migration vào DB: `npm run db:migrate` (scripts/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
