"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { cameraName, formatBytes, formatShutter, type JsonValue, type NormalizedMetadata, type RawMetadata } from "@/lib/image/metadata";
import { nearestAspectRatio } from "@/lib/image/stats";

interface Props {
  metadata: NormalizedMetadata;
  raw: RawMetadata | null;
  photo: { width: number; height: number; mime: string; sizeBytes: number; gpsSaved: boolean };
}

function flatten(value: JsonValue, prefix = ""): [string, string][] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  const text = Array.isArray(value) ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") : String(value);
  return [[prefix, text]];
}

export function ExifPanel({ metadata: m, raw, photo }: Props) {
  const t = useTranslations("exif");
  const tr = useTranslations("result");
  const format = useFormatter();

  const rows: [string, string | undefined][] = [
    ["camera", cameraName(m)],
    ["device", t("deviceType", { type: m.deviceType })],
    ["lens", m.lensModel],
    ["aperture", m.fNumber ? `f/${m.fNumber}` : undefined],
    ["shutter", formatShutter(m.exposureTime)],
    ["iso", m.iso?.toString()],
    [
      "focal",
      m.focalLength
        ? `${Math.round(m.focalLength * 10) / 10}mm${m.focalLength35 ? ` (${t("focal35", { mm: Math.round(m.focalLength35) })})` : ""}`
        : undefined,
    ],
    ["ev", m.exposureBias !== undefined ? `${m.exposureBias > 0 ? "+" : ""}${Math.round(m.exposureBias * 100) / 100} EV` : undefined],
    ["program", m.exposureProgram],
    ["metering", m.meteringMode],
    ["wb", m.whiteBalance],
    ["flash", m.flash],
    ["takenAt", m.takenAt ? format.dateTime(new Date(m.takenAt), { dateStyle: "medium", timeStyle: "short" }) : undefined],
    ["dimensions", `${photo.width} × ${photo.height} px`],
    ["aspect", nearestAspectRatio(photo.width, photo.height)],
    ["fileSize", formatBytes(photo.sizeBytes)],
    ["format", photo.mime.replace("image/", "").toUpperCase()],
    ["colorSpace", m.colorSpace],
    ["icc", m.iccProfile],
    ["software", m.software],
    ["artist", m.artist],
    ["copyright", m.copyright],
    ["gps", m.gps ? `${m.gps.lat.toFixed(5)}, ${m.gps.lng.toFixed(5)}` : photo.gpsSaved ? undefined : t("gpsHidden")],
  ];
  const groups = raw ? Object.entries(raw).filter(([, v]) => v && typeof v === "object" && Object.keys(v).length > 0) : [];

  return (
    <section className="card space-y-3 p-5" data-testid="exif-panel">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Camera className="size-5 text-accent" aria-hidden />
        {tr("exif")}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted">{t(key as "camera")}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
      </dl>

      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold select-none">{tr("rawMetadata")}</summary>
        <div className="max-h-[28rem] space-y-3 overflow-auto border-t border-border p-3">
          {groups.length === 0 && <p className="text-sm text-muted">{tr("noRaw")}</p>}
          {groups.map(([group, value]) => {
            const entries = flatten(value);
            return (
              <div key={group}>
                <p className="mb-1 text-xs font-bold tracking-wide text-accent uppercase">
                  {group} <span className="font-normal text-muted">({entries.length})</span>
                </p>
                <table className="w-full text-xs">
                  <tbody>
                    {entries.map(([k, v]) => (
                      <tr key={k} className="border-b border-border/60 align-top last:border-0">
                        <td className="py-1 pr-3 font-mono whitespace-nowrap text-muted">{k}</td>
                        <td className="py-1 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
