import "server-only";

/**
 * Tập trung mọi quyết định "dùng dịch vụ thật hay chế độ local".
 * - Có biến môi trường của dịch vụ → dùng dịch vụ thật.
 * - Thiếu (khi chạy local) → dùng bản thay thế để vẫn chạy/test được app.
 * - Production (Vercel) mà thiếu → báo lỗi rõ ràng, không âm thầm dùng bản giả.
 */

const isProd = process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_SERVICES;

const has = (...keys: string[]) => keys.every((k) => !!process.env[k]?.trim());

export const OCI_ENV_KEYS = [
  "OCI_NAMESPACE",
  "OCI_REGION",
  "OCI_BUCKET",
  "OCI_ACCESS_KEY_ID",
  "OCI_SECRET_ACCESS_KEY",
] as const;

function pick<T extends string>(name: string, real: T, local: T, ready: boolean, missing: string): T {
  if (ready) return real;
  if (isProd) throw new Error(`[config] ${name}: thiếu ${missing} trong biến môi trường`);
  return local;
}

export const config = {
  get database() {
    return pick("database", "neon", "pglite", has("DATABASE_URL"), "DATABASE_URL");
  },
  get storage() {
    const forced = process.env.STORAGE_DRIVER?.trim();
    if (forced === "local" || forced === "oci") return forced;
    return pick("storage", "oci", "local", has(...OCI_ENV_KEYS), OCI_ENV_KEYS.join(", "));
  },
  get ai() {
    if (process.env.AI_PROVIDER === "mock") return "mock" as const;
    return pick("ai", "gemini", "mock", has("GEMINI_API_KEY"), "GEMINI_API_KEY");
  },
  get googleLogin() {
    return has("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET");
  },
  /** Nút "Đăng nhập dev" — chỉ khi chạy local, không bao giờ trên production. */
  get devLogin() {
    return process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN !== "0";
  },
  get geminiModel() {
    return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
  },
  /** Tính năng xoá vật thể (model MI-GAN chạy trên trình duyệt) — mặc định tắt. */
  get objectRemoval() {
    return /^(1|true|on|yes)$/i.test(process.env.ENABLE_OBJECT_REMOVAL?.trim() ?? "");
  },
  get dailyQuota() {
    const n = Number(process.env.DAILY_QUOTA);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
  },
};

/** Danh sách các thành phần đang chạy ở chế độ local — hiện banner nhắc người dùng. */
export function localModeServices(): string[] {
  const out: string[] = [];
  try {
    if (config.database === "pglite") out.push("database");
    if (config.storage === "local") out.push("storage");
    if (config.ai === "mock") out.push("ai");
  } catch {
    // production thiếu env — lỗi sẽ được báo ở nơi dùng thật
  }
  return out;
}
