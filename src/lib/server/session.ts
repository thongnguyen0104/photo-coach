import "server-only";
import { auth } from "@/auth";
import { AppError } from "./errors";

/** Lấy userId của người đang đăng nhập, hoặc ném lỗi 401. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new AppError("unauthorized");
  return id;
}
