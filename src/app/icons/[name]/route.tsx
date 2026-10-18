import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brand-icon";

const ICONS: Record<string, { size: number; maskable?: boolean }> = {
  "192.png": { size: 192 },
  "512.png": { size: 512 },
  "maskable-512.png": { size: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

/** Icon PWA cho manifest (vẽ bằng code, không cần file ảnh). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(<BrandIcon size={icon.size} maskable={icon.maskable} />, { width: icon.size, height: icon.size });
}
