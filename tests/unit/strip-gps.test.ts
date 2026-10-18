import { describe, expect, it } from "vitest";
import exifr from "exifr";
import { scrubGpsInPlace } from "@/lib/image/strip-gps";
import { hasGps, normalizeMetadata, type RawMetadata } from "@/lib/image/metadata";
import { exifOnlyJpeg } from "../fixtures/exif-jpeg";

const EXIFR_OPTIONS = { tiff: true, ifd0: true, exif: true, gps: true, xmp: true, mergeOutput: false, translateValues: true, reviveValues: true } as never;

const camera = { make: "Canon", model: "Canon EOS R6", iso: 3200, fNumber: [18, 10] as [number, number], gps: { lat: 10.7769, lng: 106.7009 } };

async function read(bytes: Uint8Array): Promise<RawMetadata> {
  const raw = ((await exifr.parse(Buffer.from(bytes), EXIFR_OPTIONS)) ?? {}) as RawMetadata;
  const gps = await exifr.gps(Buffer.from(bytes)).catch(() => undefined);
  if (gps && Number.isFinite(gps.latitude)) raw.gps = { ...((raw.gps as object) ?? {}), latitude: gps.latitude, longitude: gps.longitude };
  return raw;
}

describe("xoá GPS khỏi file ảnh", () => {
  it("JPEG: hết GPS, giữ nguyên EXIF máy ảnh và kích thước file", async () => {
    const bytes = new Uint8Array(exifOnlyJpeg(camera));
    expect(hasGps(await read(bytes))).toBe(true);

    const before = bytes.length;
    expect(scrubGpsInPlace(bytes)).toBeGreaterThan(0);
    expect(bytes.length).toBe(before);

    const raw = await read(bytes);
    expect(hasGps(raw)).toBe(false);
    const m = normalizeMetadata(raw);
    expect(m.gps).toBeUndefined();
    expect(m.make).toBe("Canon");
    expect(m.iso).toBe(3200);
    expect(m.fNumber).toBeCloseTo(1.8);
  });

  it("JPEG không có GPS: không đổi byte nào", () => {
    const bytes = new Uint8Array(exifOnlyJpeg({ make: "Canon", iso: 100 }));
    const copy = bytes.slice();
    expect(scrubGpsInPlace(bytes)).toBe(0);
    expect(bytes).toEqual(copy);
  });

  it("XMP: xoá giá trị exif:GPS… (dạng thuộc tính và dạng thẻ)", () => {
    const xmp = `<x:xmpmeta><rdf:Description exif:GPSLatitude="10,46.6N" exif:GPSLongitude='106,42.1E'><exif:GPSAltitude>12/1</exif:GPSAltitude><tiff:Make>Canon</tiff:Make></rdf:Description></x:xmpmeta>`;
    const bytes = new Uint8Array(Buffer.from(xmp, "latin1"));
    expect(scrubGpsInPlace(bytes)).toBe(3);
    const out = Buffer.from(bytes).toString("latin1");
    expect(out).not.toMatch(/10,46|106,42|12\/1/);
    expect(out).toContain("<tiff:Make>Canon</tiff:Make>");
    expect(out.length).toBe(xmp.length);
  });

  it("hasGps nhận ra GPS trong XMP", () => {
    expect(hasGps({ xmp: { GPSLatitude: "10,46.6N" } } as RawMetadata)).toBe(true);
    expect(hasGps({ xmp: { GPSLatitude: "   " } } as RawMetadata)).toBe(false);
    expect(hasGps(null)).toBe(false);
  });
});
