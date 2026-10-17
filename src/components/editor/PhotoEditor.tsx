"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { ArrowLeft, Crop, Download, Eraser, Eye, Loader2, Redo2, RotateCcw, Share2, SlidersHorizontal, Sparkles, Undo2 } from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis/types";
import type { ImageStats } from "@/lib/image/stats";
import { ADJUSTMENT_KEYS, NEUTRAL, isNeutral, suggestedAdjustments, type Adjustments } from "@/lib/editor/adjust";
import {
  MAX_ROTATION,
  MIN_CROP_SIZE,
  contextRect,
  cropForRatio,
  cropFromBox,
  cropRect,
  fullCrop,
  normalizeCrop,
  parseRatio,
  rotationForTilt,
  type CropState,
  type Rect,
} from "@/lib/editor/geometry";
import { featherComposite, featherWidth } from "@/lib/editor/composite";
import { useInpainter } from "@/lib/editor/inpaint";
import { MODEL_BYTES } from "@/lib/editor/inpaint-model";
import { canvasToBlob, ctx2d, downscale, editedFileName, loadSourceImage, makeCanvas, renderImage } from "@/lib/editor/render";

export interface PhotoEditorProps {
  analysisId: string;
  originalUrl: string;
  mime: string;
  fileName: string;
  width: number;
  height: number;
  result: AnalysisResult | null;
  stats: ImageStats | null;
  /** Bật tab xoá vật thể (env ENABLE_OBJECT_REMOVAL) */
  objectRemoval: boolean;
}

type Tab = "remove" | "crop" | "adjust";
type Patch = { x: number; y: number; before: ImageData; after: ImageData };

/** Cạnh dài của ảnh xem trước (đủ nét trên màn hình retina, vẫn chỉnh mượt). */
const PREVIEW_EDGE = 1600;

const RATIO_PRESETS = ["1:1", "4:5", "3:2", "16:9", "9:16"];

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

const noopSubscribe = () => () => {};
/** Trình duyệt có chia sẻ được file không (điện thoại: mở bảng "Lưu ảnh", Zalo, Messenger…). */
function detectFileShare() {
  try {
    return !!navigator.canShare?.({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

export function PhotoEditor({ analysisId, originalUrl, mime, fileName, width, height, result, stats, objectRemoval }: PhotoEditorProps) {
  const t = useTranslations("editor");
  const inpainter = useInpainter();

  // Ảnh làm việc độ phân giải đầy đủ (bị sửa trực tiếp mỗi lần xoá vật thể) + bản gốc để so sánh
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const originalPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [tab, setTab] = useState<Tab>(objectRemoval ? "remove" : "crop");
  const [rotate, setRotate] = useState(0);
  const [crop, setCrop] = useState<CropState>(() => fullCrop(width, height));
  const [adj, setAdj] = useState<Adjustments>(NEUTRAL);
  const [brush, setBrush] = useState(4);
  const [comparing, setComparing] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"inpaint" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canShare = useSyncExternalStore(noopSubscribe, detectFileShare, () => false);
  const [srcSize, setSrcSize] = useState({ w: width, h: height });

  const undoStack = useRef<Patch[]>([]);
  const redoStack = useRef<Patch[]>([]);
  const [historyLen, setHistoryLen] = useState({ undo: 0, redo: 0 });

  const viewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const cropDrag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const rect = useMemo(() => cropRect(crop, width, height), [crop, width, height]);
  const isCropped = rect.w < 0.999 || rect.h < 0.999;
  const dirty = historyLen.undo > 0 || rotate !== 0 || isCropped || !isNeutral(adj);

  // 1. Tải ảnh gốc
  useEffect(() => {
    let alive = true;
    loadSourceImage(originalUrl, mime)
      .then((src) => {
        if (!alive) return;
        sourceRef.current = src;
        setSrcSize({ w: src.width, h: src.height });
        // Mỗi lần xoá vật thể tạo bản xem trước mới → bản đầu tiên giữ nguyên làm "ảnh gốc" để so sánh
        const p = downscale(src, PREVIEW_EDGE);
        originalPreviewRef.current = p;
        setPreview(p);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [originalUrl, mime, loadAttempt]);

  // Cảnh báo khi rời trang mà chưa tải ảnh đã chỉnh
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Tự chuẩn bị model nếu đã có sẵn trong bộ nhớ trình duyệt (không tốn mạng)
  const { status: modelStatus, load: loadModel, run: runInpaint } = inpainter;
  useEffect(() => {
    if (tab === "remove" && modelStatus.state === "idle" && modelStatus.cached) loadModel().catch(() => {});
  }, [tab, modelStatus, loadModel]);

  // 2. Vẽ ảnh xem trước theo tab + thông số hiện tại
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !preview) return;
    const id = requestAnimationFrame(() => {
      if (comparing && originalPreviewRef.current) {
        const o = originalPreviewRef.current;
        view.width = o.width;
        view.height = o.height;
        ctx2d(view).drawImage(o, 0, 0);
        return;
      }
      renderImage(
        preview,
        {
          rotate: tab === "remove" ? 0 : rotate,
          crop: tab === "adjust" ? rect : null,
          adjustments: adj,
        },
        Infinity,
        view,
      );
      const mask = maskRef.current;
      if (mask && (mask.width !== view.width || mask.height !== view.height)) {
        mask.width = view.width;
        mask.height = view.height;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [preview, tab, rotate, rect, adj, comparing]);

  const refreshPreview = useCallback(() => {
    if (sourceRef.current) setPreview(downscale(sourceRef.current, PREVIEW_EDGE));
    setHistoryLen({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, []);

  // ---------------------------------------------------------------------------
  // Xoá vật thể
  // ---------------------------------------------------------------------------

  const clearMask = () => {
    const m = maskRef.current;
    if (m) ctx2d(m).clearRect(0, 0, m.width, m.height);
  };

  const maskPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const m = e.currentTarget;
    const r = m.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * m.width, y: ((e.clientY - r.top) / r.height) * m.height };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const m = maskRef.current!;
    const g = ctx2d(m);
    g.strokeStyle = g.fillStyle = "#ef4444";
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = (brush / 100) * Math.max(m.width, m.height); // cỡ cọ = % cạnh dài của ảnh
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x + 0.01, to.y);
    g.stroke();
  };

  const onMaskDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = maskPoint(e);
    drawing.current = p;
    paint(p, p);
    if (modelStatus.state === "idle") loadModel().catch(() => {});
  };

  const onMaskMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = maskPoint(e);
    paint(drawing.current, p);
    drawing.current = p;
  };

  const onMaskUp = () => {
    if (!drawing.current) return;
    drawing.current = null;
    void commitMask();
  };

  async function commitMask() {
    const mask = maskRef.current;
    const src = sourceRef.current;
    if (!mask || !src) return;
    const md = ctx2d(mask).getImageData(0, 0, mask.width, mask.height).data;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (md[(y * mask.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return;

    setBusy("inpaint");
    setError(null);
    try {
      // Đổi toạ độ ảnh xem trước → ảnh độ phân giải đầy đủ
      const s = src.width / mask.width;
      const holes: Rect = { x: x0 * s, y: y0 * s, w: (x1 - x0 + 1) * s, h: (y1 - y0 + 1) * s };
      const area = contextRect(holes, src.width, src.height);

      // Mask cho đúng vùng đó, phóng lên cùng độ phân giải (nét cọ mềm → tràn ra 1–2px, giúp xoá sạch viền)
      const big = makeCanvas(area.w, area.h);
      const bg = ctx2d(big);
      bg.imageSmoothingQuality = "high";
      bg.drawImage(mask, area.x / s, area.y / s, area.w / s, area.h / s, 0, 0, area.w, area.h);
      const alpha = bg.getImageData(0, 0, area.w, area.h).data;
      const holeMask = new Uint8Array(area.w * area.h);
      for (let i = 0; i < holeMask.length; i++) holeMask[i] = alpha[i * 4 + 3] > 0 ? 0 : 255;

      const g = ctx2d(src);
      const before = g.getImageData(area.x, area.y, area.w, area.h);
      const out = await runInpaint(before, holeMask);
      featherComposite(before.data, out, holeMask, area.w, area.h, featherWidth(holes.w, holes.h));
      const after = new ImageData(new Uint8ClampedArray(out), area.w, area.h);
      g.putImageData(after, area.x, area.y);
      undoStack.current.push({ x: area.x, y: area.y, before, after });
      if (undoStack.current.length > 30) undoStack.current.shift();
      redoStack.current = [];
      refreshPreview();
    } catch (err) {
      setError(t("remove.failed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      clearMask();
      setBusy(null);
    }
  }

  const undo = useCallback(() => {
    const p = undoStack.current.pop();
    if (!p || !sourceRef.current) return;
    ctx2d(sourceRef.current).putImageData(p.before, p.x, p.y);
    redoStack.current.push(p);
    refreshPreview();
  }, [refreshPreview]);

  const redo = useCallback(() => {
    const p = redoStack.current.pop();
    if (!p || !sourceRef.current) return;
    ctx2d(sourceRef.current).putImageData(p.after, p.x, p.y);
    undoStack.current.push(p);
    refreshPreview();
  }, [refreshPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || busy) return;
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, busy]);

  // ---------------------------------------------------------------------------
  // Cắt khung: kéo để di chuyển
  // ---------------------------------------------------------------------------

  const onCropDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDrag.current = { x: e.clientX, y: e.clientY, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
  };

  const onCropMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = cropDrag.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!d || !frame) return;
    const cx = d.cx + (e.clientX - d.x) / frame.width;
    const cy = d.cy + (e.clientY - d.y) / frame.height;
    setCrop((c) => normalizeCrop({ ...c, cx, cy }, width, height));
  };

  const ratioOf = (preset: string) => (preset === "original" ? width / height : (parseRatio(preset) ?? 1));
  const choosePreset = (preset: string) => {
    if (preset === "ai" && result?.suggestedCrop) setCrop(cropFromBox(result.suggestedCrop.box, width, height));
    else setCrop((c) => cropForRatio(ratioOf(preset), preset, c, width, height));
  };

  // ---------------------------------------------------------------------------
  // Gợi ý AI
  // ---------------------------------------------------------------------------

  const tiltFix = rotationForTilt(result?.horizon?.tiltDeg);

  function applyAi() {
    const items: string[] = [];
    if (tiltFix) {
      setRotate(tiltFix);
      items.push(t("applied.rotate", { deg: signed(tiltFix) }));
    }
    if (result?.suggestedCrop) {
      setCrop(cropFromBox(result.suggestedCrop.box, width, height));
      items.push(t("applied.crop", { ratio: result.suggestedCrop.aspectRatio }));
    }
    const next = suggestedAdjustments(result, stats);
    setAdj(next);
    for (const k of ADJUSTMENT_KEYS) if (next[k]) items.push(`${t(`adjust.${k}`)} ${signed(next[k])}`);
    setApplied(items);
    setTab("adjust");
  }

  // ---------------------------------------------------------------------------
  // Xuất ảnh
  // ---------------------------------------------------------------------------

  const outputType = mime === "image/png" ? "image/png" : "image/jpeg";
  const outName = editedFileName(fileName, outputType === "image/png" ? "png" : "jpg");
  const outSize = { w: Math.round(rect.w * srcSize.w), h: Math.round(rect.h * srcSize.h) };
  const downscaled = srcSize.w < width;

  async function exportBlob() {
    setBusy("export");
    setError(null);
    // Nhường 1 khung hình để hiện trạng thái "đang xuất" trước khi tính nặng
    await new Promise((r) => setTimeout(r, 30));
    try {
      const out = renderImage(sourceRef.current!, { rotate, crop: rect, adjustments: adj });
      return await canvasToBlob(out, outputType, 0.92);
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    try {
      const blob = await exportBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setError(t("exportFailed", { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function share() {
    try {
      const blob = await exportBlob();
      await navigator.share({ files: [new File([blob], outName, { type: outputType })] });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(t("exportFailed", { error: String(err) }));
    }
  }

  // ---------------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="card mx-auto max-w-xl space-y-4 p-6">
        <p role="alert" className="text-bad">
          {t("loadFailed")}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setLoadError(false);
              setLoadAttempt((n) => n + 1);
            }}
          >
            {t("retry")}
          </button>
          <Link href={`/analyze/${analysisId}`} className="btn btn-ghost">
            {t("back")}
          </Link>
        </div>
      </div>
    );
  }

  const modelPercent =
    modelStatus.state === "loading" && modelStatus.total ? Math.round((modelStatus.loaded / modelStatus.total) * 100) : null;
  const iconBtn = "btn btn-ghost px-3";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/analyze/${analysisId}`} className={iconBtn} aria-label={t("back")} title={t("back")}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <h1 className="mr-auto text-lg font-bold">{t("title")}</h1>
        <button type="button" className={iconBtn} onClick={undo} disabled={!historyLen.undo || !!busy} aria-label={t("undo")} title={t("undo")}>
          <Undo2 className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} onClick={redo} disabled={!historyLen.redo || !!busy} aria-label={t("redo")} title={t("redo")}>
          <Redo2 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={clsx(iconBtn, comparing && "bg-surface-2")}
          disabled={!preview}
          aria-label={t("compare")}
          title={t("compare")}
          onPointerDown={() => setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
          onPointerCancel={() => setComparing(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Eye className="size-4" aria-hidden />
        </button>
        {canShare && (
          <button type="button" className={iconBtn} onClick={share} disabled={!preview || !!busy} aria-label={t("share")} title={t("share")}>
            <Share2 className="size-4" aria-hidden />
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={download} disabled={!preview || !!busy} data-testid="editor-download">
          {busy === "export" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {t("download")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Ảnh */}
        <div className="space-y-2 self-start lg:sticky lg:top-20">
          <div className="card grid min-h-64 place-items-center overflow-hidden bg-surface-2 p-2">
            {!preview ? (
              <p className="flex items-center gap-2 py-24 text-muted">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                {t("loading")}
              </p>
            ) : (
              <div ref={frameRef} className="relative w-fit max-w-full select-none" data-testid="editor-frame">
                <canvas ref={viewRef} className="block max-h-[70vh] max-w-full" data-testid="editor-canvas" />
                {tab === "remove" && !comparing && (
                  <canvas
                    ref={maskRef}
                    data-testid="editor-mask"
                    aria-label={t("remove.hint")}
                    className={clsx("absolute inset-0 size-full touch-none opacity-50", busy ? "cursor-wait" : "cursor-crosshair")}
                    onPointerDown={onMaskDown}
                    onPointerMove={onMaskMove}
                    onPointerUp={onMaskUp}
                    onPointerCancel={onMaskUp}
                  />
                )}
                {tab === "crop" && !comparing && (
                  <div
                    data-testid="crop-box"
                    className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                    style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
                    onPointerDown={onCropDown}
                    onPointerMove={onCropMove}
                    onPointerUp={() => (cropDrag.current = null)}
                    onPointerCancel={() => (cropDrag.current = null)}
                  >
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }, (_, i) => (
                        <div key={i} className="border border-white/40" />
                      ))}
                    </div>
                  </div>
                )}
                {busy === "inpaint" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30 text-white">
                    <p className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium" role="status">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {modelStatus.state === "loading"
                        ? modelPercent !== null
                          ? t("remove.modelLoading", { percent: modelPercent })
                          : t("remove.modelPreparing")
                        : t("remove.working")}
                    </p>
                  </div>
                )}
                {comparing && (
                  <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">{t("original")}</span>
                )}
              </div>
            )}
          </div>
          {preview && (
            <p className="text-center text-xs text-muted" data-testid="output-size">
              {t("outputSize", { w: outSize.w, h: outSize.h })} · {t("noMetadata")}
              {downscaled && <> · {t("downscaled")}</>}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
        </div>

        {/* Bảng điều khiển */}
        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <button type="button" className="btn btn-primary w-full" onClick={applyAi} disabled={!preview || !!busy}>
              <Sparkles className="size-4" aria-hidden />
              {t("aiApply")}
            </button>
            {applied === null ? (
              <p className="text-sm text-muted">{t("aiHint")}</p>
            ) : applied.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="ai-applied">
                <span className="text-muted">{t("aiApplied")}</span>
                {applied.map((a) => (
                  <span key={a} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{t("aiNothing")}</p>
            )}
          </section>

          <div role="tablist" className={clsx("grid gap-1 rounded-xl bg-surface-2 p-1", objectRemoval ? "grid-cols-3" : "grid-cols-2")}>
            {(
              [
                ["remove", Eraser],
                ["crop", Crop],
                ["adjust", SlidersHorizontal],
              ] as const
            )
              .filter(([key]) => objectRemoval || key !== "remove")
              .map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                disabled={!!busy}
                onClick={() => setTab(key)}
                className={clsx(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors",
                  tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-text",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(`tabs.${key}`)}
              </button>
            ))}
          </div>

          {tab === "remove" && (
            <section className="card space-y-4 p-4" role="tabpanel">
              <p className="text-sm leading-relaxed">{t("remove.hint")}</p>
              <Slider label={t("remove.brush")} value={brush} min={1} max={12} step={0.5} onChange={setBrush} format={(v) => `${v}`} />
              <ModelStatus status={modelStatus} percent={modelPercent} onLoad={() => loadModel().catch(() => {})} t={t} />
              <p className="text-xs text-muted">{t("remove.tip")}</p>
            </section>
          )}

          {tab === "crop" && (
            <section className="card space-y-4 p-4" role="tabpanel">
              <div className="space-y-2">
                <p className="text-sm font-semibold">{t("crop.ratio")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {["original", ...(result?.suggestedCrop ? ["ai"] : []), ...RATIO_PRESETS].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => choosePreset(p)}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-sm",
                        crop.preset === p ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-surface-2",
                      )}
                    >
                      {p === "original" ? t("crop.original") : p === "ai" ? `${t("crop.ai")} ${result?.suggestedCrop?.aspectRatio}` : p}
                    </button>
                  ))}
                </div>
              </div>
              <Slider
                label={t("crop.size")}
                value={Math.round(crop.size * 100)}
                min={MIN_CROP_SIZE * 100}
                max={100}
                onChange={(v) => setCrop((c) => normalizeCrop({ ...c, size: v / 100 }, width, height))}
                format={(v) => `${v}%`}
              />
              <Slider
                label={t("crop.rotate")}
                value={rotate}
                min={-MAX_ROTATION}
                max={MAX_ROTATION}
                step={0.1}
                onChange={setRotate}
                format={(v) => `${signed(Math.round(v * 10) / 10)}°`}
              />
              <div className="flex flex-wrap gap-2">
                {tiltFix !== 0 && (
                  <button type="button" className="btn btn-ghost py-1.5" onClick={() => setRotate(tiltFix)}>
                    {t("crop.level", { deg: signed(tiltFix) })}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost py-1.5"
                  onClick={() => {
                    setRotate(0);
                    setCrop(fullCrop(width, height));
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {t("reset")}
                </button>
              </div>
              <p className="text-xs text-muted">{t("crop.dragHint")}</p>
            </section>
          )}

          {tab === "adjust" && (
            <section className="card space-y-4 p-4" role="tabpanel">
              {ADJUSTMENT_KEYS.map((k) => (
                <Slider key={k} label={t(`adjust.${k}`)} value={adj[k]} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, [k]: v }))} format={signed} />
              ))}
              <button type="button" className="btn btn-ghost py-1.5" onClick={() => setAdj(NEUTRAL)} disabled={isNeutral(adj)}>
                <RotateCcw className="size-4" aria-hidden />
                {t("reset")}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-sm">
        <span>{props.label}</span>
        <span className="font-semibold tabular-nums">{props.format(props.value)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-accent"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onDoubleClick={() => props.onChange(props.min < 0 ? 0 : props.max)}
      />
    </label>
  );
}

function ModelStatus({
  status,
  percent,
  onLoad,
  t,
}: {
  status: ReturnType<typeof useInpainter>["status"];
  percent: number | null;
  onLoad: () => void;
  t: ReturnType<typeof useTranslations<"editor">>;
}) {
  const box = "rounded-xl bg-surface-2 p-3 text-sm";
  if (status.state === "ready") return <p className={clsx(box, "text-good")} data-testid="model-ready">{t("remove.modelReady")}</p>;
  if (status.state === "error")
    return (
      <div className={clsx(box, "space-y-2")}>
        <p className="text-bad">{t("remove.modelError", { error: status.message })}</p>
        <button type="button" className="btn btn-ghost py-1.5" onClick={onLoad}>
          {t("retry")}
        </button>
      </div>
    );
  if (status.state === "loading")
    return (
      <div className={clsx(box, "space-y-2")} role="status">
        <p>{percent !== null ? t("remove.modelLoading", { percent }) : t("remove.modelPreparing")}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent ?? 5}%` }} />
        </div>
      </div>
    );
  if (status.cached) return null; // đang tự chuẩn bị
  return (
    <div className={clsx(box, "space-y-2")}>
      <p>{t("remove.modelFirst", { mb: Math.round(MODEL_BYTES / 1e6) })}</p>
      <button type="button" className="btn btn-ghost py-1.5" onClick={onLoad}>
        <Download className="size-4" aria-hidden />
        {t("remove.modelDownload")}
      </button>
    </div>
  );
}
