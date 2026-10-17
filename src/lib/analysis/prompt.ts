import { cameraName, formatShutter, type NormalizedMetadata } from "@/lib/image/metadata";
import { nearestAspectRatio, type ImageStats } from "@/lib/image/stats";
import { describeFactForPrompt } from "./facts";
import type { Fact } from "./types";

/** Tăng khi sửa prompt để so sánh chất lượng giữa các phiên bản. */
export const PROMPT_VERSION = "2026-10-17.1";

export type Locale = "vi" | "en";
export type Mode = "basic" | "advanced";

const LANG: Record<Locale, string> = {
  vi: "Vietnamese (tiếng Việt, natural and friendly, address the user as \"bạn\")",
  en: "English (natural and friendly)",
};

export function buildSystemInstruction(locale: Locale, mode: Mode): string {
  return `You are a warm, honest and highly skilled photography coach.
You review ONE photo and help the photographer improve.

WRITE EVERY TEXT FIELD IN ${LANG[locale]}.

AUDIENCE MODE: ${
    mode === "basic"
      ? "BASIC — beginner, probably shooting on a phone. Use everyday words, no jargon (if a term is unavoidable, explain it in a few words). Tips must be doable on a phone camera app (tap to focus, drag the exposure slider, turn on HDR/grid, move your feet, change angle)."
      : "ADVANCED — enthusiast with a camera. Use proper terms (EV, stops, aperture, shutter, ISO, focal length, DOF, metering, bracketing) and give concrete settings and editing values."
  }

TONE RULES (very important):
1. Praise must be GENUINE and SPECIFIC: every strength must point to something visible in this photo or a measured number. Never use generic praise. If the photo is weak, praise less — but whatever you praise must be true.
2. Every improvement follows "praise first, then improve": praiseFirst = a true compliment about something related that already works; suggestion = "if you … it would be even better because …"; howTo = concrete steps.
3. Be kind but honest; never insult. Do not over-criticise intentional artistic choices (e.g. warm golden-hour tones, silhouettes, motion blur for effect) — mention them as options instead.
4. NEVER invent camera settings. Use only the EXIF and measured facts provided. If something is unknown, say it could not be read.
5. Prefer 3-6 improvements ordered by impact. Skip categories that do not apply (e.g. no "subject" score if there is no clear subject).

ANALYSE: composition (rule of thirds, golden ratio, leading lines, balance, negative space, horizon level, distractions at edges), crop/aspect ratio, subject placement (headroom, eyes near the upper third line, looking room, avoid cutting at joints: neck/elbows/wrists/knees/ankles), exposure & dynamic range (HDR need), white balance, camera settings (aperture/DOF, shutter/motion, ISO/noise), focus.

COORDINATES: all coordinates are integers 0-1000, normalised to image width (x) and height (y), origin top-left. Boxes are [ymin, xmin, ymax, xmax].
- subjects: box around each person/main subject; faceBox for visible faces.
- horizon: endpoints of the actual horizon or dominant horizontal line as it appears (only if one exists).
- marker/box on each improvement: where the issue is on the image.
- suggestedCrop: only if a crop clearly improves the photo; must keep the subject and stay inside the image.`;
}

export function buildUserPrompt(input: {
  meta: NormalizedMetadata;
  stats: ImageStats;
  facts: Fact[];
  width: number;
  height: number;
}): string {
  const { meta, stats, facts, width, height } = input;
  const exif = [
    cameraName(meta) ? `Camera: ${cameraName(meta)} (${meta.deviceType})` : "Camera: unknown",
    meta.lensModel && `Lens: ${meta.lensModel}`,
    meta.fNumber && `Aperture: f/${meta.fNumber}`,
    meta.exposureTime && `Shutter: ${formatShutter(meta.exposureTime)}`,
    meta.iso && `ISO: ${meta.iso}`,
    meta.focalLength && `Focal length: ${meta.focalLength}mm${meta.focalLength35 ? ` (35mm equiv ${meta.focalLength35}mm)` : ""}`,
    meta.exposureBias !== undefined && `Exposure compensation: ${meta.exposureBias} EV`,
    meta.exposureProgram && `Exposure program: ${meta.exposureProgram}`,
    meta.meteringMode && `Metering: ${meta.meteringMode}`,
    meta.whiteBalance && `White balance: ${meta.whiteBalance}`,
    meta.flash && `Flash: ${meta.flash}`,
    meta.software && `Software: ${meta.software}`,
  ].filter(Boolean);

  return `PHOTO: ${width}×${height}px, aspect ≈ ${nearestAspectRatio(width, height)}.

EXIF:
${exif.map((l) => `- ${l}`).join("\n")}

MEASURED (computed from pixels, reliable):
- Mean luminance ${stats.meanLuma}/255, median ${stats.medianLuma}, 2nd–98th percentile ${stats.p2Luma}–${stats.p98Luma}, contrast (std) ${stats.stdLuma}
- Clipped highlights ${(stats.clippedHighlights * 100).toFixed(1)}%, crushed shadows ${(stats.clippedShadows * 100).toFixed(1)}%
- Warmth ${stats.warmth} (>0 warm, <0 cool), tint ${stats.tint} (>0 green, <0 magenta), saturation ${stats.saturation}

FACTS:
${facts.length ? facts.map((f) => `- [${f.severity}] ${describeFactForPrompt(f)}`).join("\n") : "- (none)"}

Review the attached photo and return the JSON.`;
}
