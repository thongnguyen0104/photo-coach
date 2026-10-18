import type { MetadataRoute } from "next";

/** Cho phép "Cài đặt ứng dụng" / "Thêm vào Màn hình chính" (PWA). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Photo Coach",
    short_name: "Photo Coach",
    description: "Chụp ảnh đẹp hơn với AI hướng dẫn · Take better photos with AI coaching",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#12110f",
    theme_color: "#d97706",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Chụp với hướng dẫn", short_name: "Chụp", url: "/camera", icons: [{ src: "/icons/192.png", sizes: "192x192" }] }],
  };
}
