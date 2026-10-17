import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { config } from "@/lib/config";
import { uploadRequestSchema } from "@/lib/api-schemas";
import { AppError, errorResponse } from "@/lib/server/errors";
import { createPhotoUpload } from "@/lib/server/photos";
import { requireUserId } from "@/lib/server/session";

/** Tạo bản ghi ảnh + trả về 2 URL để trình duyệt upload thẳng lên storage. */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = uploadRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_input", parsed.error.issues[0]?.message, parsed.error.issues.slice(0, 5));

    const result = await createPhotoUpload(
      { db: await getDb(), storage: await getStorage(), dailyQuota: config.dailyQuota },
      userId,
      parsed.data,
    );
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
