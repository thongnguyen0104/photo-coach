"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";
import { Crop as CropIcon, Image as ImageIcon } from "lucide-react";
import type { AnalysisResult, Box } from "@/lib/analysis/types";

type LayerKey = "markers" | "thirds" | "golden" | "horizon" | "subjects" | "crop" | "clipping";

interface Props {
  src: string;
  width: number;
  height: number;
  result: AnalysisResult;
  activeId: string | null;
  onActivate: (id: string | null) => void;
}

const rectProps = ([y1, x1, y2, x2]: Box) => ({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
const LINE = { vectorEffect: "non-scaling-stroke" as const };

/** Vẽ vùng cháy sáng (đỏ) / tối đen (xanh) từ pixel thật của ảnh. */
function useClippingMask(src: string, enabled: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled || !canvasRef.current) return;
      try {
        const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const work = document.createElement("canvas");
        work.width = w;
        work.height = h;
        const wctx = work.getContext("2d", { willReadFrequently: true })!;
        wctx.drawImage(img, 0, 0, w, h);
        const src = wctx.getImageData(0, 0, w, h);
        const out = new ImageData(w, h);
        for (let i = 0; i < src.data.length; i += 4) {
          const r = src.data[i];
          const g = src.data[i + 1];
          const b = src.data[i + 2];
          if (r >= 254 || g >= 254 || b >= 254) {
            out.data.set([255, 40, 40, 200], i);
          } else if (0.2126 * r + 0.7152 * g + 0.0722 * b <= 3) {
            out.data.set([40, 120, 255, 200], i);
          }
        }
        const canvas = canvasRef.current;
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.putImageData(out, 0, 0);
        setFailed(false);
      } catch {
        setFailed(true); // ảnh khác domain không cho đọc pixel (CORS)
      }
    };
    img.onerror = () => !cancelled && setFailed(true);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);

  return { canvasRef, failed };
}

export function PhotoOverlay({ src, width, height, result, activeId, onActivate }: Props) {
  const t = useTranslations("result");
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    markers: true,
    thirds: true,
    golden: false,
    horizon: !!result.horizon,
    subjects: result.subjects.length > 0,
    crop: !!result.suggestedCrop,
    clipping: false,
  });
  const [cropPreview, setCropPreview] = useState(false);
  const { canvasRef, failed: clippingFailed } = useClippingMask(src, layers.clipping);

  const available: LayerKey[] = [
    "markers",
    "thirds",
    "golden",
    ...(result.horizon ? (["horizon"] as const) : []),
    ...(result.subjects.length ? (["subjects"] as const) : []),
    ...(result.suggestedCrop ? (["crop"] as const) : []),
    "clipping",
  ];
  const active = result.improvements.find((i) => i.id === activeId);
  const crop = result.suggestedCrop;
  const horizon = result.horizon;
  const absTilt = horizon ? Math.abs(horizon.tiltDeg) : 0;

  // ---------------------------------------------------------------- Xem trước crop
  if (cropPreview && crop) {
    const [y1, x1, y2, x2] = crop.box.map((v) => v / 1000);
    const cw = x2 - x1;
    const ch = y2 - y1;
    return (
      <div className="space-y-3">
        <div className="relative w-full overflow-hidden rounded-xl bg-surface-2" style={{ aspectRatio: `${cw * width} / ${ch * height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="absolute max-w-none"
            style={{ width: `${100 / cw}%`, height: `${100 / ch}%`, left: `${(-x1 / cw) * 100}%`, top: `${(-y1 / ch) * 100}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            <strong>{t("crop", { ratio: crop.aspectRatio })}</strong> — {crop.reason}
          </p>
          <button type="button" className="btn btn-ghost py-1.5" onClick={() => setCropPreview(false)}>
            <ImageIcon className="size-4" aria-hidden />
            {t("cropOriginal")}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Ảnh + các lớp đánh dấu
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-surface-2" data-testid="photo-overlay">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="block h-auto w-full" />

        {layers.clipping && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />}

        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {layers.crop && crop && (
            <>
              <path
                fillRule="evenodd"
                fill="rgba(0,0,0,0.45)"
                d={`M0 0H1000V1000H0Z M${crop.box[1]} ${crop.box[0]}H${crop.box[3]}V${crop.box[2]}H${crop.box[1]}Z`}
              />
              <rect {...rectProps(crop.box)} fill="none" stroke="#fbbf24" strokeWidth={2} strokeDasharray="6 4" {...LINE} />
            </>
          )}
          {layers.thirds &&
            [333.3, 666.7].map((p) => (
              <g key={p} stroke="rgba(255,255,255,0.75)" strokeWidth={1} {...LINE}>
                <line x1={p} y1={0} x2={p} y2={1000} {...LINE} />
                <line x1={0} y1={p} x2={1000} y2={p} {...LINE} />
              </g>
            ))}
          {layers.golden &&
            [381.966, 618.034].map((p) => (
              <g key={p} stroke="rgba(251,191,36,0.85)" strokeWidth={1} strokeDasharray="4 4">
                <line x1={p} y1={0} x2={p} y2={1000} {...LINE} />
                <line x1={0} y1={p} x2={1000} y2={p} {...LINE} />
              </g>
            ))}
          {layers.subjects &&
            result.subjects.map((s, i) => (
              <g key={i} fill="none">
                <rect {...rectProps(s.box)} stroke="#38bdf8" strokeWidth={2} {...LINE} />
                {s.faceBox && <rect {...rectProps(s.faceBox)} stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="3 3" {...LINE} />}
              </g>
            ))}
          {layers.horizon && horizon && (
            <>
              <line
                x1={Math.min(horizon.x1, horizon.x2)}
                x2={Math.max(horizon.x1, horizon.x2)}
                y1={(horizon.y1 + horizon.y2) / 2}
                y2={(horizon.y1 + horizon.y2) / 2}
                stroke="#4ade80"
                strokeWidth={2}
                strokeDasharray="8 5"
                {...LINE}
              />
              <line x1={horizon.x1} y1={horizon.y1} x2={horizon.x2} y2={horizon.y2} stroke={absTilt >= 1 ? "#f87171" : "#4ade80"} strokeWidth={2.5} {...LINE} />
            </>
          )}
          {active?.box && <rect {...rectProps(active.box)} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" strokeWidth={3} {...LINE} />}
        </svg>

        {layers.subjects &&
          result.subjects.map((s, i) => (
            <span
              key={i}
              className="pointer-events-none absolute -translate-y-full rounded-t bg-sky-400 px-1.5 text-[11px] font-semibold text-slate-900"
              style={{ left: `${s.box[1] / 10}%`, top: `${s.box[0] / 10}%` }}
            >
              {s.label}
            </span>
          ))}

        {layers.horizon && horizon && (
          <span
            className={clsx(
              "pointer-events-none absolute -translate-x-full -translate-y-[130%] rounded-md px-2 py-0.5 text-xs font-semibold shadow",
              absTilt >= 1 ? "bg-red-500 text-white" : "bg-green-500 text-slate-900",
            )}
            style={{ left: `${Math.max(horizon.x1, horizon.x2) / 10}%`, top: `${Math.min(horizon.y1, horizon.y2) / 10}%` }}
          >
            {absTilt >= 1 ? t("tilt", { deg: absTilt.toFixed(1) }) : t("tiltLevel")}
          </span>
        )}

        {layers.markers &&
          result.improvements
            .filter((imp) => imp.marker)
            .map((imp) => (
              <button
                key={imp.id}
                type="button"
                data-testid="marker"
                onMouseEnter={() => onActivate(imp.id)}
                onMouseLeave={() => onActivate(null)}
                onFocus={() => onActivate(imp.id)}
                onBlur={() => onActivate(null)}
                onClick={() => document.getElementById(`imp-${imp.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className={clsx(
                  "absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-sm font-bold shadow-lg transition-transform",
                  activeId === imp.id ? "scale-125 bg-accent text-accent-fg" : "bg-slate-900/80 text-white",
                )}
                style={{ left: `${imp.marker!.x / 10}%`, top: `${imp.marker!.y / 10}%` }}
                aria-label={`${imp.n}. ${imp.title}`}
              >
                {imp.n}
              </button>
            ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("layers")}>
        {available.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={layers[key]}
            onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-medium",
              layers[key] ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-text",
            )}
          >
            {t(`layer.${key}`)}
          </button>
        ))}
        {crop && (
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline" onClick={() => setCropPreview(true)}>
            <CropIcon className="size-3.5" aria-hidden />
            {t("cropPreview")} {crop.aspectRatio}
          </button>
        )}
      </div>

      {horizon && absTilt >= 1 && (
        <p className="text-sm text-muted">{t("rotateHint", { deg: absTilt.toFixed(1), dir: horizon.tiltDeg > 0 ? "ccw" : "cw" })}</p>
      )}
      {layers.clipping && clippingFailed && <p className="text-xs text-bad">{t("clippingUnavailable")}</p>}
    </div>
  );
}
