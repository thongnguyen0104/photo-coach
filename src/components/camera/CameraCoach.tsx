"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Camera, Grid3x3, ImageUp, Loader2, Ratio, Ruler, SunMedium, X } from "lucide-react";
import { Uploader } from "@/components/upload/Uploader";
import type { CaptureInfo } from "@/lib/image/metadata";
import { computeImageStats } from "@/lib/image/stats";
import {
  CameraError,
  capturePhoto,
  isMobileDevice,
  openCamera,
  requestOrientationPermission,
  stopStream,
} from "@/lib/camera/capture";
import { exposureHints, FRAME_INTERVAL_MS, FRAME_SAMPLE_EDGE, HintStabilizer, type ExposureHint } from "@/lib/camera/exposure";
import { aspectRect, ASPECTS, gridLines, GRIDS, type Aspect, type GridKind } from "@/lib/camera/frame";
import { LEVEL_OK_DEG, levelFromOrientation, smoothAngle, type LevelReading } from "@/lib/camera/level";

type Phase =
  | { step: "intro" }
  | { step: "starting" }
  | { step: "live" }
  | { step: "error"; code: CameraError["code"] }
  | { step: "captured"; file: File; capture?: CaptureInfo };

const PREFS_KEY = "photo-coach:camera";

function loadPrefs(): { grid: GridKind; aspect: Aspect } {
  const fallback = { grid: "thirds" as GridKind, aspect: "full" as Aspect };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      grid: GRIDS.includes(p.grid) ? p.grid : fallback.grid,
      aspect: ASPECTS.includes(p.aspect) ? p.aspect : fallback.aspect,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(prefs: { grid: GridKind; aspect: Aspect }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // trình duyệt chặn lưu trữ → bỏ qua
  }
}

const next = <T,>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];

export function CameraCoach() {
  const t = useTranslations("camera");
  const [phase, setPhase] = useState<Phase>({ step: "intro" });
  const [grid, setGrid] = useState<GridKind>("thirds");
  const [aspect, setAspect] = useState<Aspect>("full");
  const [flash, setFlash] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef<LevelReading | null>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  // Rời trang → tắt camera
  useEffect(() => () => stopStream(streamRef.current), []);

  const start = useCallback(async () => {
    // iOS: phải xin quyền cảm biến ngay trong lúc bấm, trước mọi await khác.
    // Không chờ kết quả: thước cân bằng tự hiện khi cảm biến có dữ liệu
    void requestOrientationPermission();
    setPhase({ step: "starting" });
    const prefs = loadPrefs();
    setGrid(prefs.grid);
    setAspect(prefs.aspect);
    try {
      stopStream(streamRef.current);
      streamRef.current = await openCamera();
      setPhase({ step: "live" });
    } catch (err) {
      setPhase({ step: "error", code: err instanceof CameraError ? err.code : "camera_failed" });
    }
  }, []);

  const live = phase.step === "live" || phase.step === "starting";

  // Gắn stream vào thẻ video; tự mở lại nếu camera bị tắt khi app chạy nền (iOS)
  useEffect(() => {
    if (phase.step !== "live") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible" && stream.getVideoTracks().every((tr) => tr.readyState === "ended")) start();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase.step, start]);

  // Màn hình camera chiếm toàn bộ → khoá cuộn trang
  useEffect(() => {
    if (!live) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [live]);

  async function shoot() {
    const video = videoRef.current;
    if (!video || flash) return;
    setFlash(true);
    try {
      const file = await capturePhoto(video, streamRef.current?.getVideoTracks()[0], aspect);
      const level = levelRef.current;
      const capture: CaptureInfo = {
        source: "live-camera",
        tiltDeg: level && !level.flat ? level.tiltDeg : undefined,
        aspect,
        mobile: isMobileDevice(),
      };
      stopStream(streamRef.current);
      streamRef.current = null;
      setPhase({ step: "captured", file, capture });
    } catch (err) {
      setPhase({ step: "error", code: err instanceof CameraError ? err.code : "camera_failed" });
    } finally {
      setFlash(false);
    }
  }

  const setPref = (prefs: Partial<{ grid: GridKind; aspect: Aspect }>) => {
    const merged = { grid, aspect, ...prefs };
    setGrid(merged.grid);
    setAspect(merged.aspect);
    savePrefs(merged);
  };

  const nativeInput = (
    <input
      ref={nativeInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      data-testid="native-camera-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) setPhase({ step: "captured", file });
        e.target.value = "";
      }}
    />
  );

  // ---------------------------------------------------------------- đã chụp → luồng phân tích như upload
  if (phase.step === "captured") {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{t("capturedTitle")}</h1>
        <Uploader initialFile={phase.file} capture={phase.capture} onCancel={start} />
      </div>
    );
  }

  // ---------------------------------------------------------------- giới thiệu / lỗi
  if (!live) {
    const unsupported = phase.step === "error" && phase.code === "camera_unsupported";
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
        <div className="card space-y-4 p-5">
          <p>{t("intro")}</p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <Grid3x3 className="size-5 shrink-0 text-accent" aria-hidden />
              {t("featureGrid")}
            </li>
            <li className="flex gap-2">
              <Ruler className="size-5 shrink-0 text-accent" aria-hidden />
              {t("featureLevel")}
            </li>
            <li className="flex gap-2">
              <SunMedium className="size-5 shrink-0 text-accent" aria-hidden />
              {t("featureLight")}
            </li>
          </ul>
          <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">{t("limitation")}</p>

          {phase.step === "error" && (
            <p role="alert" className="text-sm font-medium text-bad">
              {t(`errors.${phase.code}`)}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!unsupported && (
              <button type="button" className="btn btn-primary flex-1" onClick={start} data-testid="start-camera">
                <Camera className="size-4" aria-hidden />
                {phase.step === "error" ? t("retry") : t("start")}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => nativeInputRef.current?.click()}>
              <ImageUp className="size-4" aria-hidden />
              {t("nativeCamera")}
            </button>
          </div>
          {nativeInput}
        </div>
        <Link href="/" className="inline-block text-sm text-muted hover:text-text">
          ← {t("back")}
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------- camera trực tiếp
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="camera-live"
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-2">
        <Link href="/" className="rounded-full p-2 hover:bg-white/10" aria-label={t("close")} title={t("close")}>
          <X className="size-6" aria-hidden />
        </Link>
        <span className="text-sm font-medium text-white/80">{t("title")}</span>
        <span className="w-10" />
      </div>

      <Stage videoRef={videoRef} grid={grid} aspect={aspect} levelRef={levelRef} starting={phase.step === "starting"} />

      <ExposureControl streamRef={streamRef} active={phase.step === "live"} />

      <div className="grid shrink-0 grid-cols-3 items-center px-4 py-4">
        <button
          type="button"
          className="justify-self-start rounded-full bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
          onClick={() => setPref({ grid: next(GRIDS, grid) })}
          aria-label={t("grid")}
          data-testid="grid-toggle"
        >
          <Grid3x3 className="mr-1 inline size-4" aria-hidden />
          {t(`grids.${grid}`)}
        </button>
        <button
          type="button"
          onClick={shoot}
          disabled={phase.step !== "live" || flash}
          className="size-18 justify-self-center rounded-full border-4 border-white bg-white/90 transition active:scale-95 disabled:opacity-50"
          aria-label={t("shutter")}
          data-testid="shutter"
        />
        <button
          type="button"
          className="justify-self-end rounded-full bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
          onClick={() => setPref({ aspect: next(ASPECTS, aspect) })}
          aria-label={t("aspect")}
          data-testid="aspect-toggle"
        >
          <Ratio className="mr-1 inline size-4" aria-hidden />
          {aspect === "full" ? t("aspectFull") : aspect}
        </button>
      </div>

      {flash && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/70" />}
    </div>
  );
}

// ================================================================ khung ngắm + lớp phủ

function Stage(props: {
  videoRef: RefObject<HTMLVideoElement | null>;
  grid: GridKind;
  aspect: Aspect;
  levelRef: RefObject<LevelReading | null>;
  starting: boolean;
}) {
  const { videoRef, grid, aspect, levelRef, starting } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const readDims = () => {
    const v = videoRef.current;
    if (v?.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight });
  };

  // Vùng video thực sự hiển thị (object-contain) → lớp phủ khớp đúng từng pixel
  const scale = dims.w && box.w ? Math.min(box.w / dims.w, box.h / dims.h) : 0;
  const view = scale
    ? { width: dims.w * scale, height: dims.h * scale, left: (box.w - dims.w * scale) / 2, top: (box.h - dims.h * scale) / 2 }
    : { width: "100%", height: "100%", left: 0, top: 0 };

  const r = dims.w ? aspectRect(dims.w, dims.h, aspect) : null;

  return (
    <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute" style={view}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={readDims}
          onResize={readDims}
          className="h-full w-full object-contain"
          data-testid="camera-video"
        />
        {r && (
          <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {aspect !== "full" && (
              <path
                d={`M0 0H${dims.w}V${dims.h}H0Z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`}
                fillRule="evenodd"
                fill="black"
                fillOpacity={0.6}
              />
            )}
            {gridLines(grid).map((l, i) => (
              <g key={i}>
                {[
                  { stroke: "black", width: 2.5, opacity: 0.25 },
                  { stroke: "white", width: 1, opacity: 0.7 },
                ].map((s) => (
                  <line
                    key={s.stroke}
                    x1={r.x + l.x1 * r.w}
                    y1={r.y + l.y1 * r.h}
                    x2={r.x + l.x2 * r.w}
                    y2={r.y + l.y2 * r.h}
                    stroke={s.stroke}
                    strokeOpacity={s.opacity}
                    strokeWidth={s.width}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ))}
          </svg>
        )}
        <Level levelRef={levelRef} />
        <Hints videoRef={videoRef} />
      </div>
      {starting && (
        <div className="absolute inset-0 grid place-items-center">
          <Loader2 className="size-10 animate-spin text-white/80" aria-hidden />
        </div>
      )}
    </div>
  );
}

// ================================================================ thước cân bằng

function Level({ levelRef }: { levelRef: RefObject<LevelReading | null> }) {
  const t = useTranslations("camera");
  const [reading, setReading] = useState<LevelReading | null>(null);

  useEffect(() => {
    let smooth: number | null = null;
    let lastPaint = 0;
    let pending = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0);
      const raw = levelFromOrientation(e.beta, e.gamma, angle);
      smooth = smoothAngle(smooth, raw.tiltDeg);
      const value = { tiltDeg: Math.round(smooth * 10) / 10, flat: raw.flat };
      levelRef.current = value;
      // Vẽ lại tối đa ~12 lần/giây cho nhẹ máy, nhưng luôn vẽ giá trị cuối cùng
      const paint = () => {
        pending = 0;
        lastPaint = performance.now();
        setReading(levelRef.current);
      };
      const wait = 80 - (performance.now() - lastPaint);
      if (wait <= 0) paint();
      else if (!pending) pending = window.setTimeout(paint, wait);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.clearTimeout(pending);
    };
  }, [levelRef]);

  if (!reading || reading.flat) return null;
  const ok = Math.abs(reading.tiltDeg) < LEVEL_OK_DEG;
  const color = ok ? "#4ade80" : "#fbbf24";

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" data-testid="level">
      <div className="relative flex w-56 flex-col items-center gap-2">
        <div className="relative h-0.5 w-full">
          {/* Vạch chuẩn cố định hai bên */}
          <span className="absolute left-0 top-0 h-0.5 w-8 bg-white/60" />
          <span className="absolute right-0 top-0 h-0.5 w-8 bg-white/60" />
          {/* Đường chân trời theo cảm biến */}
          <span
            className="absolute left-10 right-10 top-0 h-0.5 transition-transform duration-75"
            style={{ background: color, transform: `rotate(${reading.tiltDeg}deg)` }}
          />
        </div>
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold" style={{ color }}>
          {ok ? t("level") : t("tilt", { deg: Math.abs(reading.tiltDeg).toFixed(1) })}
        </span>
      </div>
    </div>
  );
}

// ================================================================ cảnh báo sáng/tối

function Hints({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const t = useTranslations("camera");
  const [hints, setHints] = useState<ExposureHint[]>([]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const stabilizer = new HintStabilizer();
    let timer = 0;
    let last = "";
    const tick = () => {
      timer = window.setTimeout(tick, FRAME_INTERVAL_MS);
      const v = videoRef.current;
      // Tab ẩn → không đo, đỡ tốn pin
      if (document.hidden || !v || v.readyState < 2 || !v.videoWidth) return;
      const s = FRAME_SAMPLE_EDGE / Math.max(v.videoWidth, v.videoHeight);
      const w = Math.max(1, Math.round(v.videoWidth * s));
      const h = Math.max(1, Math.round(v.videoHeight * s));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(v, 0, 0, w, h);
      const stats = computeImageStats(ctx.getImageData(0, 0, w, h).data, w, h);
      const shown = stabilizer.push(exposureHints(stats)).slice(0, 2);
      const key = shown.join();
      if (key !== last) {
        last = key;
        setHints(shown);
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [videoRef]);

  if (!hints.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-2 px-3" aria-live="polite" data-testid="hints">
      {hints.map((h) => (
        <p key={h} className="max-w-sm rounded-full bg-black/60 px-3 py-1.5 text-center text-xs font-medium backdrop-blur">
          {t(`hints.${h}`)}
        </p>
      ))}
    </div>
  );
}

// ================================================================ bù sáng (chỉ máy hỗ trợ, chủ yếu Android Chrome)

interface ExposureRange {
  min: number;
  max: number;
  step: number;
}

function ExposureControl({ streamRef, active }: { streamRef: RefObject<MediaStream | null>; active: boolean }) {
  const t = useTranslations("camera");
  const [range, setRange] = useState<ExposureRange | null>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    const track = streamRef.current?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as { exposureCompensation?: ExposureRange } | undefined;
    const ec = caps?.exposureCompensation;
    if (ec && ec.max > ec.min) {
      setRange(ec);
      setValue(0);
    } else setRange(null);
  }, [active, streamRef]);

  if (!range) return null;

  const apply = (v: number) => {
    setValue(v);
    const track = streamRef.current?.getVideoTracks()[0];
    track?.applyConstraints({ advanced: [{ exposureCompensation: v } as MediaTrackConstraintSet] }).catch(() => {});
  };

  return (
    <label className="flex shrink-0 items-center gap-3 px-6 pt-3 text-xs">
      <SunMedium className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">{t("exposure")}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step || 0.1}
        value={value}
        onChange={(e) => apply(Number(e.target.value))}
        className="flex-1 accent-amber-400"
      />
      <span className="w-12 text-right tabular-nums">
        {value > 0 ? "+" : ""}
        {value.toFixed(1)} EV
      </span>
    </label>
  );
}
