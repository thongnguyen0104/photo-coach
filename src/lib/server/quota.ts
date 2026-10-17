import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { usageQuota } from "@/lib/db/schema";

/** Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD (quota reset lúc 0h VN). */
export function vnDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

export async function getUsage(db: Db, userId: string, day = vnDay()): Promise<number> {
  const [row] = await db
    .select({ count: usageQuota.count })
    .from(usageQuota)
    .where(and(eq(usageQuota.userId, userId), eq(usageQuota.day, day)));
  return row?.count ?? 0;
}

/** Trừ 1 lượt một cách nguyên tử. Trả false nếu đã hết lượt hôm nay. */
export async function consumeQuota(db: Db, userId: string, limit: number, day = vnDay()): Promise<boolean> {
  const rows = await db
    .insert(usageQuota)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [usageQuota.userId, usageQuota.day],
      set: { count: sql`${usageQuota.count} + 1` },
      setWhere: sql`${usageQuota.count} < ${limit}`,
    })
    .returning({ count: usageQuota.count });
  return rows.length > 0;
}

/** Hoàn lại 1 lượt khi phân tích lỗi (không phải lỗi của người dùng). */
export async function refundQuota(db: Db, userId: string, day = vnDay()): Promise<void> {
  await db
    .update(usageQuota)
    .set({ count: sql`greatest(${usageQuota.count} - 1, 0)` })
    .where(and(eq(usageQuota.userId, userId), eq(usageQuota.day, day)));
}
