import { nearestAspectRatio, type ImageStats } from "@/lib/image/stats";
import type { Locale, Mode } from "./prompt";
import type { AiOutput, Category, Fact } from "./types";

/**
 * "AI giả lập" cho chế độ local (chưa có GEMINI_API_KEY).
 * Kết quả dựng từ số liệu đo thật nên vẫn hợp lý để test giao diện,
 * nhưng KHÔNG nhìn được nội dung ảnh (vị trí người, chân trời… là giả định).
 */

type Tpl = { title: string; praise: string; suggestion: string; howTo: string };

const T: Record<Locale, Record<string, Tpl | string>> = {
  vi: {
    headline: "Bản phân tích mẫu — đang dùng AI giả lập ở chế độ local",
    summary:
      "Đây là kết quả mẫu được tạo từ số liệu đo thật của ảnh (độ sáng, histogram, EXIF). Khi bạn điền GEMINI_API_KEY, AI thật sẽ nhìn ảnh và nhận xét chi tiết hơn.",
    strengthExposure: "Phơi sáng cân bằng",
    strengthExposureDetail: "Ảnh không bị cháy sáng hay mất chi tiết vùng tối đáng kể.",
    strengthSharp: "Chi tiết sắc nét",
    strengthSharpDetail: "Vùng nét nhất của ảnh giữ được nhiều chi tiết.",
    strengthEffort: "Bạn đã chủ động học hỏi",
    strengthEffortDetail: "Việc tải ảnh lên để xem lại là thói quen giúp tiến bộ rất nhanh.",
    tip1: "Bật lưới 3×3 trong ứng dụng camera và đặt chủ thể ở giao điểm.",
    tip2: "Chạm vào chủ thể để lấy nét, rồi kéo thanh phơi sáng xuống nhẹ nếu trời quá sáng.",
    tip3: "Chụp thêm 2–3 góc khác nhau rồi chọn tấm đẹp nhất.",
    cropReason: "Cắt theo quy tắc 1/3 để chủ thể nổi bật hơn (gợi ý mẫu).",
    settingsNotes: "Gợi ý mẫu dựa trên số đo histogram.",
    composition: JSON.stringify({
      title: "Bố cục: thử quy tắc 1/3",
      praise: "Khung hình của bạn khá gọn gàng.",
      suggestion: "Nếu đặt chủ thể lệch về một đường 1/3 thì ảnh sẽ có chiều sâu và sinh động hơn.",
      howTo: "Bật lưới 3×3, đặt chủ thể (hoặc mắt người) vào một trong 4 giao điểm.",
    }),
    highlights_clipped: JSON.stringify({
      title: "Vùng sáng bị cháy",
      praise: "Ánh sáng trong ảnh rất có sức sống.",
      suggestion: "Nếu giảm phơi sáng một chút thì vùng sáng sẽ giữ lại được chi tiết và màu sắc.",
      howTo: "Chạm vào vùng sáng nhất rồi kéo thanh phơi sáng xuống khoảng −0.7EV; khi chỉnh ảnh: Highlights −40.",
    }),
    shadows_clipped: JSON.stringify({
      title: "Vùng tối mất chi tiết",
      praise: "Tương phản sáng tối tạo cảm giác mạnh mẽ.",
      suggestion: "Nếu kéo sáng vùng tối lên thì sẽ thấy thêm nhiều chi tiết thú vị.",
      howTo: "Khi chỉnh ảnh: Shadows +30 đến +50, hoặc bật HDR khi chụp.",
    }),
    high_dynamic_range: JSON.stringify({
      title: "Cảnh chênh sáng lớn — nên dùng HDR",
      praise: "Bạn đã chọn một khung cảnh có ánh sáng rất ấn tượng.",
      suggestion: "Nếu bật HDR thì cả vùng sáng lẫn vùng tối đều giữ được chi tiết.",
      howTo: "Bật HDR trên điện thoại, hoặc chụp bracketing ±2EV rồi ghép trên máy tính.",
    }),
    underexposed: JSON.stringify({
      title: "Ảnh hơi tối",
      praise: "Không khí trầm lắng của ảnh khá có cảm xúc.",
      suggestion: "Nếu tăng sáng một chút thì chủ thể sẽ rõ ràng hơn.",
      howTo: "Kéo thanh phơi sáng lên +0.7EV, tìm thêm nguồn sáng hoặc đứng gần cửa sổ.",
    }),
    overexposed: JSON.stringify({
      title: "Ảnh hơi sáng quá",
      praise: "Tông ảnh sáng sủa, nhẹ nhàng.",
      suggestion: "Nếu giảm sáng nhẹ thì màu sắc sẽ đậm đà hơn.",
      howTo: "Kéo thanh phơi sáng xuống −0.7EV.",
    }),
    shake_risk: JSON.stringify({
      title: "Tốc độ chậm — dễ rung tay",
      praise: "Bạn đã tận dụng được ánh sáng yếu.",
      suggestion: "Nếu dùng tốc độ nhanh hơn thì ảnh sẽ nét hơn.",
      howTo: "Tựa máy vào vật cố định, kẹp chặt khuỷu tay, hoặc tăng ISO/mở khẩu lớn hơn.",
    }),
    high_iso: JSON.stringify({
      title: "ISO cao gây nhiễu",
      praise: "Bạn vẫn bắt được khoảnh khắc trong điều kiện thiếu sáng.",
      suggestion: "Nếu hạ ISO thì ảnh sẽ mịn hơn.",
      howTo: "Tìm thêm ánh sáng, mở khẩu lớn hơn hoặc dùng chân máy để hạ ISO.",
    }),
    soft_focus: JSON.stringify({
      title: "Ảnh có thể chưa nét",
      praise: "Khoảnh khắc được ghi lại rất tự nhiên.",
      suggestion: "Nếu lấy nét chính xác vào chủ thể thì ảnh sẽ có chiều sâu hơn.",
      howTo: "Chạm vào chủ thể để lấy nét, giữ máy yên 1 giây sau khi bấm.",
    }),
  },
  en: {
    headline: "Sample analysis — running the mock AI in local mode",
    summary:
      "This sample result is built from real measurements of your photo (brightness, histogram, EXIF). Add GEMINI_API_KEY and the real AI will look at the photo and give detailed feedback.",
    strengthExposure: "Balanced exposure",
    strengthExposureDetail: "No significant blown highlights or crushed shadows.",
    strengthSharp: "Crisp detail",
    strengthSharpDetail: "The sharpest area keeps plenty of detail.",
    strengthEffort: "You are actively learning",
    strengthEffortDetail: "Reviewing your shots is the fastest way to improve.",
    tip1: "Turn on the 3×3 grid and place your subject on an intersection.",
    tip2: "Tap your subject to focus, then drag exposure down slightly in bright scenes.",
    tip3: "Take 2–3 different angles and keep the best one.",
    cropReason: "Rule-of-thirds crop to make the subject stand out (sample).",
    settingsNotes: "Sample suggestion based on the histogram.",
    composition: JSON.stringify({
      title: "Composition: try the rule of thirds",
      praise: "Your framing is clean.",
      suggestion: "If you place the subject on a third line, the photo will feel more dynamic.",
      howTo: "Turn on the 3×3 grid and put the subject (or the eyes) on an intersection.",
    }),
    highlights_clipped: JSON.stringify({
      title: "Blown highlights",
      praise: "The light in this photo feels lively.",
      suggestion: "If you lower exposure slightly, the bright areas will keep their detail and colour.",
      howTo: "Tap the brightest area and drag exposure to about −0.7EV; when editing: Highlights −40.",
    }),
    shadows_clipped: JSON.stringify({
      title: "Crushed shadows",
      praise: "The contrast gives the image punch.",
      suggestion: "If you lift the shadows, more interesting detail will show.",
      howTo: "When editing: Shadows +30 to +50, or turn on HDR when shooting.",
    }),
    high_dynamic_range: JSON.stringify({
      title: "High-contrast scene — use HDR",
      praise: "You picked a scene with striking light.",
      suggestion: "With HDR, both bright and dark areas would keep detail.",
      howTo: "Turn on HDR, or bracket ±2EV and merge later.",
    }),
    underexposed: JSON.stringify({
      title: "A bit dark",
      praise: "The moody atmosphere has feeling.",
      suggestion: "A little more exposure would make the subject clearer.",
      howTo: "Drag exposure to +0.7EV, find more light or move closer to a window.",
    }),
    overexposed: JSON.stringify({
      title: "A bit too bright",
      praise: "The airy tone feels light and pleasant.",
      suggestion: "Slightly less exposure would make colours richer.",
      howTo: "Drag exposure to −0.7EV.",
    }),
    shake_risk: JSON.stringify({
      title: "Slow shutter — camera shake risk",
      praise: "You made good use of low light.",
      suggestion: "A faster shutter would make the photo sharper.",
      howTo: "Brace against something solid, tuck your elbows, or raise ISO / open the aperture.",
    }),
    high_iso: JSON.stringify({
      title: "High ISO noise",
      praise: "You still captured the moment in low light.",
      suggestion: "Lower ISO would give a cleaner image.",
      howTo: "Find more light, open the aperture or use a tripod.",
    }),
    soft_focus: JSON.stringify({
      title: "Possibly out of focus",
      praise: "The moment feels natural.",
      suggestion: "Precise focus on the subject would add depth.",
      howTo: "Tap the subject to focus and hold still for a second after shooting.",
    }),
  },
};

const ISSUE_POS: Record<string, { x: number; y: number }> = {
  highlights_clipped: { x: 500, y: 150 },
  shadows_clipped: { x: 500, y: 850 },
  high_dynamic_range: { x: 800, y: 200 },
  underexposed: { x: 500, y: 500 },
  overexposed: { x: 500, y: 500 },
  shake_risk: { x: 300, y: 450 },
  high_iso: { x: 200, y: 700 },
  soft_focus: { x: 667, y: 333 },
  composition: { x: 500, y: 500 },
};

export function mockAnalysis(facts: Fact[], stats: ImageStats, locale: Locale, mode: Mode): AiOutput {
  const t = T[locale];
  const s = (k: string) => t[k] as string;
  const tpl = (k: string) => JSON.parse(s(k)) as Tpl;
  const issueFacts = facts.filter((f) => ["low", "medium", "high"].includes(f.severity) && t[f.id]);

  const improvements: AiOutput["improvements"] = [
    ...issueFacts.map((f) => ({ id: f.id, category: f.category, severity: f.severity as "low" | "medium" | "high", key: f.id })),
    { id: "composition", category: "composition" as Category, severity: "low" as const, key: "composition" },
  ].map(({ key, ...rest }) => {
    const x = tpl(key);
    return { ...rest, title: x.title, praiseFirst: x.praise, suggestion: x.suggestion, howTo: x.howTo, marker: ISSUE_POS[key] };
  });

  const OVERALL_PENALTY: Record<string, number> = { high: 15, medium: 8, low: 3 };
  const CATEGORY_PENALTY: Record<string, number> = { high: 30, medium: 15, low: 6 };
  const penalty = facts.reduce((acc, f) => acc + (OVERALL_PENALTY[f.severity] ?? 0), 0);
  const overall = Math.max(35, Math.min(92, 82 - penalty));
  const catScore = (c: Category) =>
    Math.max(30, 85 - facts.filter((f) => f.category === c).reduce((a, f) => a + (CATEGORY_PENALTY[f.severity] ?? 0), 0));

  const strengths: AiOutput["strengths"] = [];
  if (facts.some((f) => f.id === "well_exposed")) {
    strengths.push({ title: s("strengthExposure"), detail: s("strengthExposureDetail"), evidence: `mean ${Math.round(stats.meanLuma)}/255` });
  }
  if (facts.some((f) => f.id === "sharp")) {
    strengths.push({ title: s("strengthSharp"), detail: s("strengthSharpDetail"), evidence: `sharpness ${Math.round(stats.sharpnessMax)}` });
  }
  strengths.push({ title: s("strengthEffort"), detail: s("strengthEffortDetail"), evidence: "—" });

  const landscape = stats.sampleWidth >= stats.sampleHeight;
  return {
    overallScore: overall,
    headline: s("headline"),
    summary: s("summary"),
    genre: "other",
    scores: (["composition", "exposure", "white_balance", "focus", "settings"] as Category[]).map((c) => ({ category: c, score: catScore(c) })),
    strengths,
    improvements,
    horizon: landscape ? { x1: 0, y1: 640, x2: 1000, y2: 660 } : undefined,
    subjects: [{ label: locale === "vi" ? "chủ thể (giả định)" : "subject (assumed)", box: [250, 380, 900, 620] }],
    suggestedCrop: {
      box: landscape ? [0, 60, 1000, 940] : [60, 0, 940, 1000],
      aspectRatio: nearestAspectRatio(landscape ? stats.sampleWidth * 0.88 : stats.sampleWidth, landscape ? stats.sampleHeight : stats.sampleHeight * 0.88),
      reason: s("cropReason"),
    },
    suggestedSettings: {
      exposureCompensation: stats.clippedHighlights > 0.02 ? "-0.7 EV" : stats.meanLuma < 70 ? "+0.7 EV" : "0 EV",
      hdr: facts.some((f) => f.id === "high_dynamic_range"),
      editing: mode === "advanced" ? ["Highlights -30", "Shadows +25", "Clarity +10"] : undefined,
      notes: s("settingsNotes"),
    },
    nextShotTips: [s("tip1"), s("tip2"), s("tip3")],
  };
}
