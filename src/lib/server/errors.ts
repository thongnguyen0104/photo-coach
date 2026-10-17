import type { ApiErrorCode } from "@/lib/api-schemas";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_input: 400,
  not_found: 404,
  quota_exceeded: 429,
  upload_missing: 409,
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

/** Chuyển lỗi thành Response JSON thống nhất { error, message }. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.code, message: err.message, details: err.details }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "server_error", message: "Internal error" }, { status: 500 });
}
