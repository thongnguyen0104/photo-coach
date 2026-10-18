import type { ApiErrorCode } from "@/lib/api-schemas";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_input: 400,
  not_found: 404,
  quota_exceeded: 429,
  upload_missing: 409,
  upload_too_large: 413,
  too_many_uploads: 429,
  ai_rate_limited: 503,
  ai_failed: 502,
  server_error: 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
  get status() {
    return STATUS[this.code];
  }
}

/** Lấy mã lỗi từ chuỗi đã lưu dạng "mã: chi tiết" (bản ghi cũ không có mã → ai_failed). */
export function storedErrorCode(stored: string | null | undefined): ApiErrorCode {
  const code = stored?.match(/^([a-z_]+):/)?.[1];
  return code && code in STATUS ? (code as ApiErrorCode) : "ai_failed";
}

/** Chuyển lỗi thành Response JSON thống nhất { error, message }. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    // Lỗi từ nhà cung cấp AI có thể chứa chi tiết nội bộ → chỉ ghi log, không gửi cho người dùng
    if (err.code.startsWith("ai_")) {
      console.error(`[${err.code}]`, err.message);
      return Response.json({ error: err.code, message: err.code }, { status: err.status });
    }
    return Response.json({ error: err.code, message: err.message, details: err.details }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "server_error", message: "Internal error" }, { status: 500 });
}
