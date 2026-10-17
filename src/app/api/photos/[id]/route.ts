import { z } from "zod";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { AppError, errorResponse } from "@/lib/server/errors";
import { deletePhoto } from "@/lib/server/photos";
import { requireUserId } from "@/lib/server/session";

/** Xoá ảnh: xoá file trên storage + mọi dữ liệu liên quan trong DB. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new AppError("not_found");
    await deletePhoto({ db: await getDb(), storage: await getStorage() }, userId, id);
    return Response.json({ deleted: id });
  } catch (err) {
    return errorResponse(err);
  }
}
