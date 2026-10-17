import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // PGlite (Postgres nhúng cho chế độ local) chứa file WASM → không bundle
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Đọc cấu hình ngôn ngữ ở src/i18n/request.ts
export default createNextIntlPlugin()(nextConfig);
