"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import clsx from "clsx";
import { Camera, Download, ImageUp, Loader2, MapPin, RotateCcw, Sparkles } from "lucide-react";
import { prepareImage, PrepareError, removeGps, uploadWithProgress, type PreparedImage } from "@/lib/image/prepare";
import { cameraName, formatBytes, formatShutter, hasGps, normalizeMetadata, type CaptureInfo, type RawMetadata } from "@/lib/image/metadata";
import type { AnalysisResponse, ApiErrorCode, UploadResponse } from "@/lib/api-schemas";

type Mode = "basic" | "advanced";
type State =
  | { step: "idle" }
  | { step: "preparing" }
  | { step: "ready"; img: PreparedImage }
  | { step: "uploading"; img: PreparedImage; percent: number }
  | { step: "analyzing"; img: PreparedImage }
  | { step: "error"; code: string; img?: PreparedImage };

class ApiError extends Error {
  constructor(readonly code: ApiErrorCode | "upload_failed") {
    super(code);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json.error as ApiErrorCode) ?? "server_error");
  return json as T;
}

/** Chạy toàn bộ luồng: tạo bản ghi → upload thẳng lên storage → gọi AI. */
async function uploadAndAnalyze(
  img: PreparedImage,
  opts: { mode: Mode; locale: string; saveGps: boolean },
  onProgress: (percent: number) => void,
  onAnalyzing: () => void,
): Promise<string> {
  // Không đồng ý lưu vị trí → xoá GPS khỏi chính file gốc trước khi rời máy
  const original = !opts.saveGps && hasGps(img.rawMetadata) ? await removeGps(img.file, img.mime) : { file: img.file, mime: img.mime };

  const created = await postJson<UploadResponse>("/api/uploads", {
    fileName: original.file.name.slice(0, 200) || "photo",
    mime: original.mime,
    size: original.file.size,
    width: img.width,
    height: img.height,
    previewWidth: img.previewWidth,
    previewHeight: img.previewHeight,
    previewSize: img.preview.size,
    sha256: img.sha256,
    rawMetadata: img.rawMetadata,
    stats: img.stats,
    saveGps: opts.saveGps,
  });

  if (!created.duplicate && created.uploads) {
    const total = original.file.size + img.preview.size;
    let previewDone = 0;
    try {
      // Preview trước (nhỏ, cần cho AI), rồi tới ảnh gốc
      await uploadWithProgress(created.uploads.preview.url, img.preview, created.uploads.preview.headers, (n) => {
        previewDone = n;
        onProgress(Math.round((n / total) * 100));
      });
      await uploadWithProgress(created.uploads.original.url, original.file, created.uploads.original.headers, (n) =>
        onProgress(Math.round(((previewDone + n) / total) * 100)),
      );
    } catch {
      throw new ApiError("upload_failed");
    }
  }

  onAnalyzing();
  const analysis = await postJson<AnalysisResponse>("/api/analyses", { photoId: created.photoId, locale: opts.locale, mode: opts.mode });
  return analysis.analysisId;
}

interface Props {
  /** Ảnh có sẵn (vd vừa chụp bằng camera trong app) → bỏ qua bước chọn ảnh */
  initialFile?: File;
  /** Thông tin lúc chụp bằng camera trong app — gửi kèm để AI biết */
  capture?: CaptureInfo;
  /** Thay nút "Chọn ảnh khác" (vd quay lại camera để chụp lại) */
  onCancel?: () => void;
}

export function Uploader({ initialFile, capture, onCancel }: Props = {}) {
  const t = useTranslations("upload");
  const tErr = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<Mode>("basic");
  const [saveGps, setSaveGps] = useState(false);

  const img = "img" in state ? state.img : undefined;
  const suggestedMode: Mode = img?.metadata.deviceType === "camera" ? "advanced" : "basic";

  useEffect(() => () => {
    if (img) URL.revokeObjectURL(img.displayUrl);
  }, [img]);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setState({ step: "preparing" });
    try {
      const prepared = await prepareImage(file);
      if (capture) {
        // Ghi thông tin chụp vào metadata gốc → server chuẩn hoá lại giống hệt
        prepared.rawMetadata = { ...(prepared.rawMetadata ?? {}), capture: capture as unknown as RawMetadata[string] };
        prepared.metadata = normalizeMetadata(prepared.rawMetadata);
      }
      setMode(prepared.metadata.deviceType === "camera" ? "advanced" : "basic");
      setSaveGps(false);
      setState({ step: "ready", img: prepared });
    } catch (err) {
      setState({ step: "error", code: err instanceof PrepareError ? err.code : "decode_failed" });
    }
  }, [capture]);

  // Ảnh truyền vào từ ngoài → chuẩn bị ngay (ref chặn chạy 2 lần ở Strict Mode)
  const initialRef = useRef<File | null>(null);
  useEffect(() => {
    if (!initialFile || initialRef.current === initialFile) return;
    initialRef.current = initialFile;
    handleFile(initialFile);
  }, [initialFile, handleFile]);

  async function start(prepared: PreparedImage) {
    setState({ step: "uploading", img: prepared, percent: 0 });
    try {
      const id = await uploadAndAnalyze(
        prepared,
        { mode, locale, saveGps },
        (percent) => setState({ step: "uploading", img: prepared, percent }),
        () => setState({ step: "analyzing", img: prepared }),
      );
      router.push(`/analyze/${id}`);
    } catch (err) {
      setState({ step: "error", code: err instanceof ApiError ? err.code : "server_error", img: prepared });
    }
  }

  const reset = () => {
    if (onCancel) return onCancel();
    setState({ step: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  // ---------------------------------------------------------------- idle / preparing
  if (state.step === "idle" || state.step === "preparing" || (state.step === "error" && !state.img)) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={clsx(
          "card flex min-h-64 flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-accent bg-surface-2" : "border-border",
        )}
      >
        {state.step === "preparing" ? (
          <>
            <Loader2 className="size-10 animate-spin text-accent" aria-hidden />
            <p className="font-medium">{t("preparing")}</p>
          </>
        ) : (
          <>
            <ImageUp className="size-10 text-accent" aria-hidden />
            <p className="text-lg font-semibold">{t("dropTitle")}</p>
            <p className="text-sm text-muted">{t("dropOr")}</p>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              {t("choose")}
            </button>
            <p className="text-xs text-muted">{t("formats")}</p>
            <Link href="/camera" className="btn btn-ghost text-sm" data-testid="open-camera">
              <Camera className="size-4" aria-hidden />
              {t("liveCamera")}
            </Link>
            {state.step === "error" && (
              <p role="alert" className="text-sm font-medium text-bad">
                {tErr(state.code as never)}
              </p>
            )}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------- ready / uploading / analyzing / error
  const m = img!.metadata;
  const busy = state.step === "uploading" || state.step === "analyzing";
  const specs = [
    cameraName(m),
    m.lensModel,
    m.fNumber ? `f/${m.fNumber}` : null,
    formatShutter(m.exposureTime),
    m.iso ? `ISO ${m.iso}` : null,
    m.focalLength ? `${Math.round(m.focalLength)}mm` : null,
  ].filter(Boolean);

  return (
    <div className="card grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="relative overflow-hidden rounded-xl bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img!.displayUrl} alt="" className={clsx("mx-auto max-h-[28rem] w-auto object-contain", busy && "opacity-60")} />
        {busy && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-bg/90 px-5 py-4 text-center shadow-lg">
              {state.step === "analyzing" ? <Sparkles className="size-7 animate-pulse text-accent" /> : <Loader2 className="size-7 animate-spin text-accent" />}
              <p className="font-semibold" aria-live="polite">
                {state.step === "uploading" ? t("uploading", { percent: state.percent }) : t("analyzing")}
              </p>
              {state.step === "analyzing" && <p className="text-xs text-muted">{t("analyzingHint")}</p>}
              {state.step === "uploading" && (
                <div className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${state.percent}%` }} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <div className="space-y-1">
          <p className="truncate font-semibold" title={img!.file.name}>
            {img!.file.name}
          </p>
          <p className="text-sm text-muted">
            {t("size", { width: img!.width, height: img!.height, size: formatBytes(img!.file.size) })}
          </p>
          {m.capture ? (
            <p className="text-sm text-muted">{t("capturedHint")}</p>
          ) : specs.length > 0 ? (
            <p className="text-sm">{specs.join(" · ")}</p>
          ) : (
            <p className="text-sm text-muted">{t("noExif")}</p>
          )}
        </div>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold">{t("mode")}</legend>
          {(["basic", "advanced"] as const).map((value) => (
            <label
              key={value}
              className={clsx(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                mode === value ? "border-accent bg-surface-2" : "border-border",
              )}
            >
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--accent)]" />
              <span>
                <span className="font-medium">
                  {t(value === "basic" ? "modeBasic" : "modeAdvanced")}
                  {suggestedMode === value && (
                    <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-fg">{t("suggested")}</span>
                  )}
                </span>
                <span className="block text-xs text-muted">{t(value === "basic" ? "modeBasicHint" : "modeAdvancedHint")}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {m.gps && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={saveGps} disabled={busy} onChange={(e) => setSaveGps(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <MapPin className="mr-1 inline size-4 text-muted" aria-hidden />
              {t("gpsFound")} {t("saveGps")}
            </span>
          </label>
        )}

        {state.step === "error" && (
          <p role="alert" className="rounded-lg bg-surface-2 p-3 text-sm font-medium text-bad">
            {tErr(state.code as never)}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => start(img!)}>
            {state.step === "error" ? <RotateCcw className="size-4" /> : <Sparkles className="size-4" />}
            {state.step === "error" ? t("retry") : t("analyze")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={reset}>
            {onCancel ? <Camera className="size-4" aria-hidden /> : null}
            {t(onCancel ? "retake" : "another")}
          </button>
          {m.capture && (
            <a href={img!.displayUrl} download={img!.file.name} className="btn btn-ghost" data-testid="save-capture">
              <Download className="size-4" aria-hidden />
              {t("saveToDevice")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
