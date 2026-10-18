import { formatShutter, type NormalizedMetadata } from "@/lib/image/metadata";
import type { ImageStats } from "@/lib/image/stats";
import type { Fact } from "./types";

const pct = (n: number) => Math.round(n * 1000) / 10;

/** Vùng nào bị cháy sáng/tối nhiều nhất — "top", "bottom", "left"… */
export function dominantRegion(grid: number[], size = 6): string {
  const rows = Array.from({ length: size }, (_, r) => grid.slice(r * size, r * size + size).reduce((a, b) => a + b, 0));
  const cols = Array.from({ length: size }, (_, c) => grid.filter((_, i) => i % size === c).reduce((a, b) => a + b, 0));
  const third = (arr: number[]) => [arr.slice(0, 2), arr.slice(2, 4), arr.slice(4, 6)].map((a) => a.reduce((x, y) => x + y, 0));
  const [top, mid, bottom] = third(rows);
  const [left, center, right] = third(cols);
  const v = top >= mid && top >= bottom ? "top" : bottom >= mid ? "bottom" : "middle";
  const h = left >= center && left >= right ? "left" : right >= center ? "right" : "center";
  const vMax = Math.max(top, mid, bottom);
  const hMax = Math.max(left, center, right);
  const total = top + mid + bottom || 1;
  // Nếu phân bố đều theo chiều ngang thì chỉ nói theo chiều dọc
  return hMax / total < 0.5 ? v : vMax / total < 0.5 ? h : `${v}-${h}`;
}

/**
 * Suy ra các nhận định chắc chắn từ EXIF + số đo pixel.
 * AI sẽ dựa vào đây để không "bịa" thông số.
 */
export function deriveFacts(meta: NormalizedMetadata, stats: ImageStats): Fact[] {
  const facts: Fact[] = [];
  const isPhone = meta.deviceType === "phone";

  if (meta.capture) {
    // Chụp bằng camera trong app: trình duyệt không ghi thông số, nhưng có góc nghiêng đo bằng cảm biến
    facts.push({ id: "live_capture", category: "settings", severity: "info", values: {} });
    const tilt = meta.capture.tiltDeg;
    if (tilt !== undefined) {
      const abs = Math.abs(tilt);
      if (abs < 1) facts.push({ id: "capture_level", category: "composition", severity: "positive", values: { tilt: abs } });
      else facts.push({ id: "capture_tilt", category: "composition", severity: abs >= 3 ? "medium" : "low", values: { tilt: abs } });
    }
  } else if (!meta.hasExif) facts.push({ id: "no_exif", category: "settings", severity: "info", values: {} });

  // --- Rung tay: tốc độ chậm hơn 1/(tiêu cự 35mm) với máy ảnh; điện thoại có chống rung nên ngưỡng 1/15s
  const t = meta.exposureTime;
  const f35 = meta.focalLength35 ?? (meta.focalLength && !isPhone ? meta.focalLength : undefined);
  if (t) {
    const safe = isPhone ? 1 / 15 : f35 ? 1 / f35 : 1 / 60;
    const ratio = t / safe;
    if (ratio > 1) {
      facts.push({
        id: "shake_risk",
        category: "settings",
        severity: ratio >= 4 ? "high" : ratio >= 2 ? "medium" : "low",
        values: { shutter: formatShutter(t)!, safeShutter: formatShutter(safe)! },
      });
    }
  }

  // --- ISO cao → nhiễu
  if (meta.iso) {
    const [mid, high] = isPhone ? [800, 1600] : [3200, 6400];
    if (meta.iso >= mid) {
      facts.push({ id: "high_iso", category: "settings", severity: meta.iso >= high ? "high" : "medium", values: { iso: meta.iso } });
    }
  }

  // --- Khẩu độ
  if (meta.fNumber && !isPhone) {
    if (meta.fNumber <= 2.8) facts.push({ id: "wide_aperture", category: "settings", severity: "info", values: { f: meta.fNumber } });
    else if (meta.fNumber >= 16) facts.push({ id: "diffraction", category: "settings", severity: "low", values: { f: meta.fNumber } });
  }

  if (meta.flashFired) facts.push({ id: "flash_fired", category: "exposure", severity: "info", values: {} });
  if (meta.exposureBias) {
    facts.push({ id: "exposure_bias", category: "exposure", severity: "info", values: { ev: Math.round(meta.exposureBias * 10) / 10 } });
  }

  // --- Phơi sáng
  const hi = stats.clippedHighlights;
  const lo = stats.clippedShadows;
  if (hi > 0.02) {
    facts.push({
      id: "highlights_clipped",
      category: "exposure",
      severity: hi > 0.08 ? "high" : "medium",
      values: { percent: pct(hi), region: dominantRegion(stats.highlightGrid) },
    });
  }
  if (lo > 0.05) {
    facts.push({
      id: "shadows_clipped",
      category: "exposure",
      severity: lo > 0.15 ? "high" : "medium",
      values: { percent: pct(lo), region: dominantRegion(stats.shadowGrid) },
    });
  }
  if (hi > 0.02 && lo > 0.03) {
    facts.push({ id: "high_dynamic_range", category: "hdr", severity: "medium", values: { highlights: pct(hi), shadows: pct(lo) } });
  }
  if (stats.meanLuma < 70 && stats.p98Luma < 200) {
    facts.push({ id: "underexposed", category: "exposure", severity: stats.meanLuma < 45 ? "high" : "medium", values: { mean: Math.round(stats.meanLuma) } });
  } else if (stats.meanLuma > 185 && stats.p2Luma > 60) {
    facts.push({ id: "overexposed", category: "exposure", severity: stats.meanLuma > 210 ? "high" : "medium", values: { mean: Math.round(stats.meanLuma) } });
  } else if (hi <= 0.01 && lo <= 0.02 && stats.meanLuma >= 85 && stats.meanLuma <= 175) {
    facts.push({ id: "well_exposed", category: "exposure", severity: "positive", values: { mean: Math.round(stats.meanLuma) } });
  }
  if (stats.stdLuma < 35) facts.push({ id: "low_contrast", category: "exposure", severity: "low", values: { std: Math.round(stats.stdLuma) } });

  // --- Cân bằng trắng (có thể là chủ ý, nên mức thấp)
  if (stats.warmth > 0.25) facts.push({ id: "warm_cast", category: "white_balance", severity: "low", values: { warmth: stats.warmth } });
  else if (stats.warmth < -0.2) facts.push({ id: "cool_cast", category: "white_balance", severity: "low", values: { warmth: stats.warmth } });
  if (stats.tint > 0.12) facts.push({ id: "green_cast", category: "white_balance", severity: "low", values: { tint: stats.tint } });
  else if (stats.tint < -0.15) facts.push({ id: "magenta_cast", category: "white_balance", severity: "low", values: { tint: stats.tint } });

  // --- Độ nét (đo trên bản thu nhỏ → chỉ mang tính tham khảo)
  if (stats.sharpnessMax < 40) facts.push({ id: "soft_focus", category: "focus", severity: stats.sharpnessMax < 15 ? "high" : "medium", values: { sharpness: Math.round(stats.sharpnessMax) } });
  else if (stats.sharpnessMax > 250) facts.push({ id: "sharp", category: "focus", severity: "positive", values: { sharpness: Math.round(stats.sharpnessMax) } });

  return facts;
}

/** Diễn đạt facts bằng tiếng Anh cho prompt AI. */
export function describeFactForPrompt(f: Fact): string {
  const v = f.values;
  switch (f.id) {
    case "no_exif": return "No EXIF data (screenshot, edited or stripped). Do not guess camera settings.";
    case "live_capture": return "Captured with the app's live camera in the browser: no EXIF settings are recorded (do not guess aperture/shutter/ISO). The browser cannot set aperture/shutter/ISO, so give tips the user can do (tap to focus, exposure slider, HDR, framing, light).";
    case "capture_level": return `Phone sensor measured the camera tilt at capture: ${v.tilt}° → the frame was held level.`;
    case "capture_tilt": return `Phone sensor measured the camera tilt at capture: ${v.tilt}° (camera roll, not necessarily the scene's horizon).`;
    case "shake_risk": return `Shutter ${v.shutter} is slower than the safe handheld speed ${v.safeShutter} → risk of camera shake/motion blur.`;
    case "high_iso": return `ISO ${v.iso} is high → visible noise likely.`;
    case "wide_aperture": return `Wide aperture f/${v.f} → shallow depth of field.`;
    case "diffraction": return `Small aperture f/${v.f} → diffraction softening possible.`;
    case "flash_fired": return "Flash fired.";
    case "exposure_bias": return `Exposure compensation set to ${v.ev} EV.`;
    case "highlights_clipped": return `${v.percent}% of pixels are blown-out highlights, mostly in the ${v.region} area.`;
    case "shadows_clipped": return `${v.percent}% of pixels are crushed black shadows, mostly in the ${v.region} area.`;
    case "high_dynamic_range": return `Scene exceeds dynamic range (highlights ${v.highlights}% clipped AND shadows ${v.shadows}% crushed) → HDR / bracketing recommended.`;
    case "underexposed": return `Image is underexposed (mean luminance ${v.mean}/255).`;
    case "overexposed": return `Image is overexposed (mean luminance ${v.mean}/255).`;
    case "well_exposed": return `Exposure is well balanced (mean luminance ${v.mean}/255, almost no clipping).`;
    case "low_contrast": return `Low contrast (luminance std ${v.std}).`;
    case "warm_cast": return `Noticeable warm (orange) color cast (warmth ${v.warmth}); may be intentional (golden hour, tungsten).`;
    case "cool_cast": return `Noticeable cool (blue) color cast (warmth ${v.warmth}).`;
    case "green_cast": return `Slight green tint (${v.tint}).`;
    case "magenta_cast": return `Slight magenta tint (${v.tint}).`;
    case "soft_focus": return `Measured sharpness is low even in the sharpest area (${v.sharpness}) → possible missed focus or blur.`;
    case "sharp": return `Measured sharpness is high in the sharpest area (${v.sharpness}).`;
    default: return `${f.id}: ${JSON.stringify(v)}`;
  }
}
