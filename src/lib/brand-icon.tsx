/** Biểu tượng app (khẩu độ trên nền cam) — dùng cho icon PWA và apple-touch-icon. */
export function BrandIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  // Icon maskable bị cắt thành hình tròn/bo góc → thu nhỏ hình vào vùng an toàn 80%
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#d97706",
        borderRadius: maskable ? 0 : Math.round(size * 0.22),
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="m14.31 8 5.74 9.94" />
        <path d="M9.69 8h11.48" />
        <path d="m7.38 12 5.74-9.94" />
        <path d="M9.69 16 3.95 6.06" />
        <path d="M14.31 16H2.83" />
        <path d="m16.62 12-5.74 9.94" />
      </svg>
    </div>
  );
}
