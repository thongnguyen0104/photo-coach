import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Icon khi "Thêm vào Màn hình chính" trên iPhone (iOS tự bo góc → dùng bản vuông). */
export default function AppleIcon() {
  return new ImageResponse(<BrandIcon size={180} maskable />, size);
}
