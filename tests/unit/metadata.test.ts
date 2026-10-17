import { describe, expect, it } from "vitest";
import exifr from "exifr";
import {
  detectDeviceType,
  formatShutter,
  normalizeMetadata,
  sanitizeForJson,
  stripGps,
  type RawMetadata,
} from "@/lib/image/metadata";
import { exifOnlyJpeg } from "../fixtures/exif-jpeg";

// Cùng cấu hình đọc như ở trình duyệt (src/lib/image/prepare.ts)
const EXIFR_OPTIONS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  icc: true,
  mergeOutput: false,
  translateValues: true,
  reviveValues: true,
} as never;

describe("normalizeMetadata", () => {
  it("đọc đúng EXIF máy ảnh từ file JPEG thật (qua exifr)", async () => {
    const file = exifOnlyJpeg({
      make: "Canon",
      model: "Canon EOS R6",
      exposureTime: [1, 30],
      fNumber: [18, 10],
      iso: 3200,
      focalLength: [85, 1],
      focalLength35: 85,
      dateTimeOriginal: "2025:06:01 18:30:00",
      gps: { lat: 10.7769, lng: 106.7009 },
    });
    const segments = await exifr.parse(file, EXIFR_OPTIONS);
    const gps = await exifr.gps(file);
    const raw = sanitizeForJson({ ...segments, gps: { ...segments.gps, latitude: gps.latitude, longitude: gps.longitude } }) as RawMetadata;
    const m = normalizeMetadata(raw);

    expect(m).toMatchObject({
      hasExif: true,
      deviceType: "camera",
      make: "Canon",
      model: "Canon EOS R6",
      fNumber: 1.8,
      iso: 3200,
      focalLength: 85,
      focalLength35: 85,
    });
    expect(m.exposureTime).toBeCloseTo(1 / 30, 5);
    expect(m.takenAt).toMatch(/^2025-06-01/);
    expect(m.gps!.lat).toBeCloseTo(10.7769, 3);
    expect(m.gps!.lng).toBeCloseTo(106.7009, 3);
    // JSON hoá được (không còn Date/binary)
    expect(() => JSON.stringify(raw)).not.toThrow();
  });

  it("không có metadata → hasExif false, deviceType unknown", () => {
    expect(normalizeMetadata(null)).toEqual({ hasExif: false, deviceType: "unknown" });
  });

  it("dùng giá trị APEX khi thiếu FNumber/ExposureTime", () => {
    const m = normalizeMetadata({ exif: { ApertureValue: 4, ShutterSpeedValue: 7 } });
    expect(m.fNumber).toBe(4);
    expect(m.exposureTime).toBeCloseTo(1 / 128, 5);
  });

  it("flash dạng số: bit 0 = đã nháy", () => {
    expect(normalizeMetadata({ exif: { Flash: 25 } }).flashFired).toBe(true);
    expect(normalizeMetadata({ exif: { Flash: 16 } }).flashFired).toBe(false);
    expect(normalizeMetadata({ exif: { Flash: "Flash did not fire, compulsory flash mode" } }).flashFired).toBe(false);
  });
});

describe("detectDeviceType", () => {
  it.each([
    ["Apple", "iPhone 15 Pro", "phone"],
    ["samsung", "SM-S918B", "phone"],
    ["Sony", "XQ-DQ54", "phone"],
    ["SONY", "ILCE-7M4", "camera"],
    ["FUJIFILM", "X-T5", "camera"],
    ["", "", "unknown"],
    ["Acme", "Cam", "unknown"],
  ])("%s %s → %s", (make, model, expected) => {
    expect(detectDeviceType(make, model)).toBe(expected);
  });
});

describe("sanitizeForJson", () => {
  it("chuyển Date, binary, NaN, chuỗi/mảng dài thành JSON an toàn", () => {
    const out = sanitizeForJson({
      d: new Date("2024-01-02T03:04:05Z"),
      bin: new Uint8Array(10),
      nan: Number.NaN,
      long: "x".repeat(3000),
      arr: Array.from({ length: 100 }, (_, i) => i),
      fn: () => 1,
    }) as Record<string, unknown>;
    expect(out.d).toBe("2024-01-02T03:04:05.000Z");
    expect(out.bin).toBe("[binary 10 bytes]");
    expect(out.nan).toBeNull();
    expect((out.long as string).length).toBe(2001);
    expect((out.arr as unknown[]).length).toBe(65);
    expect(out).not.toHaveProperty("fn");
  });
});

describe("stripGps", () => {
  it("xoá nhóm gps và các trường GPS trong XMP", () => {
    const out = stripGps({ gps: { latitude: 1 }, xmp: { GPSLatitude: "1", Rating: 5 }, exif: { ISO: 100 } });
    expect(out).toEqual({ xmp: { Rating: 5 }, exif: { ISO: 100 } });
  });
});

describe("formatShutter", () => {
  it.each([
    [1 / 250, "1/250"],
    [1 / 30, "1/30"],
    [0.5, "0.5s"],
    [2, "2s"],
    [undefined, undefined],
  ])("%s → %s", (input, expected) => {
    expect(formatShutter(input)).toBe(expected);
  });
});

describe("cameraName / formatBytes", () => {
  it("không lặp tên hãng", async () => {
    const { cameraName, formatBytes } = await import("@/lib/image/metadata");
    expect(cameraName({ make: "Canon", model: "Canon EOS R6" })).toBe("Canon EOS R6");
    expect(cameraName({ make: "NIKON CORPORATION", model: "NIKON Z 6_2" })).toBe("NIKON Z 6_2");
    expect(cameraName({ make: "Apple", model: "iPhone 15 Pro" })).toBe("Apple iPhone 15 Pro");
    expect(cameraName({})).toBeUndefined();
    expect(formatBytes(800)).toBe("800 B");
    expect(formatBytes(20_480)).toBe("20 KB");
    expect(formatBytes(3_400_000)).toBe("3.2 MB");
  });
});
