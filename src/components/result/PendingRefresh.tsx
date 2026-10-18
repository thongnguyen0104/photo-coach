"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Ảnh đang được phân tích → cứ vài giây hỏi lại server cho tới khi có kết quả. */
export function PendingRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
