/**
 * Chuẩn hoá metadata đọc bằng exifr (EXIF/TIFF/GPS/XMP/IPTC/ICC…).
 * Hàm thuần, chạy được cả browser lẫn Node.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
/** Toàn bộ metadata gốc, theo từng nhóm (ifd0, exif, gps, xmp, iptc, icc…) */
export type RawMetadata = Record<string, JsonValue>;

export type DeviceType = "phone" | "camera" | "unknown";

export interface NormalizedMetadata {
  hasExif: boolean;
  deviceType: DeviceType;
  make?: string;
  model?: string;
  lensModel?: string;
  software?: string;
  fNumber?: number;
  /** giây, vd 0.004 = 1/250 */
  exposureTime?: number;
  iso?: number;
  focalLength?: number;
  focalLength35?: number;
  exposureBias?: number;
  exposureProgram?: string;
  exposureMode?: string;
  meteringMode?: string;
  whiteBalance?: string;
  flash?: string;
  flashFired?: boolean;
  sceneType?: string;
  takenAt?: string;
  orientation?: string;
  colorSpace?: string;
  iccProfile?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  gps?: { lat: number; lng: number; altitude?: number };
  artist?: string;
  copyright?: string;
  title?: string;
  description?: string;
  keywords?: string[];
  rating?: number;
}

const PHONE_MAKES = [
  "apple", "samsung", "google", "xiaomi", "redmi", "poco", "oppo", "vivo", "huawei", "honor", "oneplus",
  "realme", "motorola", "nokia", "hmd", "asus", "nothing", "zte", "tecno", "infinix", "lg electronics",
];
const CAMERA_MAKES = [
  "canon", "nikon", "sony", "fujifilm", "panasonic", "olympus", "om digital", "leica", "pentax", "ricoh",
  "hasselblad", "sigma", "phase one", "gopro", "dji",
];

export function detectDeviceType(make?: string, model?: string): DeviceType {
  const m = (make ?? "").toLowerCase().trim();
  const mo = (model ?? "").toLowerCase();
  if (!m) return "unknown";
  // Sony Xperia ghi make "Sony" nhưng model bắt đầu bằng XQ-/SO-
  if (m.startsWith("sony") && /^(xq-|so-|xperia)/.test(mo)) return "phone";
  if (PHONE_MAKES.some((p) => m.startsWith(p))) return "phone";
  if (CAMERA_MAKES.some((p) => m.startsWith(p))) return "camera";
  return "unknown";
}

type Seg = Record<string, unknown> | undefined;

const str = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String).join(", ") || undefined;
  if (typeof v === "object") {
    // XMP dạng { lang: 'x-default', value: '...' }
    const value = (v as { value?: unknown }).value;
    return value != null ? String(value).trim() || undefined : undefined;
  }
  const s = String(v).replace(/\0/g, "").trim();
  return s || undefined;
};

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === "number") return num(v[0]);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

const iso = (v: unknown): string | undefined => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "string") {
    // "2024:05:01 10:20:30" → ISO
    const m = v.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  return undefined;
};

/** Lấy giá trị theo tên tag từ các nhóm, ưu tiên theo thứ tự truyền vào. */
function tag(segs: Seg[], ...names: string[]): unknown {
  for (const name of names) {
    for (const s of segs) {
      if (s && s[name] !== undefined && s[name] !== null && s[name] !== "") return s[name];
    }
  }
  return undefined;
}

/**
 * @param raw  output của exifr.parse(file, { mergeOutput: false, ... })
 *             (các nhóm ifd0, exif, gps, xmp, iptc, icc, ihdr…)
 */
export function normalizeMetadata(raw: Record<string, unknown> | null | undefined): NormalizedMetadata {
  const r = (raw ?? {}) as Record<string, Seg>;
  const ifd0 = r.ifd0;
  const exif = r.exif;
  const gps = r.gps;
  const xmp = r.xmp;
  const iptc = r.iptc;
  const icc = r.icc;
  const ihdr = r.ihdr;
  const all: Seg[] = [exif, ifd0, xmp, iptc, ihdr];

  const make = str(tag([ifd0, xmp], "Make"));
  const model = str(tag([ifd0, xmp], "Model"));
  const flashRaw = tag([exif], "Flash");
  const flash = str(flashRaw);

  const lat = num(tag([gps], "latitude"));
  const lng = num(tag([gps], "longitude"));

  const keywords = tag([iptc, xmp], "Keywords", "subject");
  // Giá trị APEX dự phòng khi thiếu FNumber/ExposureTime
  const apertureApex = num(tag([exif], "ApertureValue"));
  const shutterApex = num(tag([exif], "ShutterSpeedValue"));
  const out: NormalizedMetadata = {
    hasExif: !!(exif || ifd0),
    deviceType: detectDeviceType(make, model),
    make,
    model,
    lensModel: str(tag([exif, xmp], "LensModel", "Lens")),
    software: str(tag([ifd0, xmp], "Software", "CreatorTool")),
    fNumber:
      num(tag([exif], "FNumber")) ??
      (apertureApex !== undefined ? Math.round(2 ** (apertureApex / 2) * 10) / 10 : undefined),
    exposureTime: num(tag([exif], "ExposureTime")) ?? (shutterApex !== undefined ? 2 ** -shutterApex : undefined),
    iso: num(tag([exif], "ISO", "ISOSpeedRatings", "PhotographicSensitivity")),
    focalLength: num(tag([exif], "FocalLength")),
    focalLength35: num(tag([exif], "FocalLengthIn35mmFormat", "FocalLengthIn35mmFilm")),
    exposureBias: num(tag([exif], "ExposureCompensation", "ExposureBiasValue")),
    exposureProgram: str(tag([exif], "ExposureProgram")),
    exposureMode: str(tag([exif], "ExposureMode")),
    meteringMode: str(tag([exif], "MeteringMode")),
    whiteBalance: str(tag([exif], "WhiteBalance")),
    flash,
    flashFired:
      typeof flashRaw === "number"
        ? (flashRaw & 1) === 1
        : flash
          ? /fired/i.test(flash) && !/did not fire|not fire|no flash/i.test(flash)
          : undefined,
    sceneType: str(tag([exif], "SceneCaptureType")),
    takenAt: iso(tag([exif, ifd0, xmp], "DateTimeOriginal", "CreateDate", "DateCreated", "ModifyDate")),
    orientation: str(tag([ifd0], "Orientation")),
    colorSpace: str(tag([exif], "ColorSpace")),
    iccProfile: str(tag([icc], "ProfileDescription", "description")),
    pixelWidth: num(tag(all, "ExifImageWidth", "PixelXDimension", "ImageWidth")),
    pixelHeight: num(tag(all, "ExifImageHeight", "PixelYDimension", "ImageHeight")),
    gps: lat !== undefined && lng !== undefined ? { lat, lng, altitude: num(tag([gps], "GPSAltitude")) } : undefined,
    artist: str(tag([ifd0, xmp, iptc], "Artist", "creator", "Byline")),
    copyright: str(tag([ifd0, xmp, iptc], "Copyright", "rights", "CopyrightNotice")),
    title: str(tag([xmp, iptc], "title", "ObjectName", "Headline")),
    description: str(tag([ifd0, xmp, iptc], "ImageDescription", "description", "Caption")),
    keywords: Array.isArray(keywords) ? keywords.map(String) : typeof keywords === "string" ? [keywords] : undefined,
    rating: num(tag([xmp], "Rating")),
  };

  // Bỏ các key undefined cho gọn JSON
  for (const k of Object.keys(out) as (keyof NormalizedMetadata)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const MAX_STRING = 2000;
const MAX_ARRAY = 64;
const MAX_DEPTH = 6;

/** Biến output exifr thành JSON an toàn: bỏ binary, Date → ISO, cắt chuỗi/mảng quá dài. */
export function sanitizeForJson(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const s = value.replace(/\0/g, "");
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[binary ${(value as ArrayBuffer).byteLength} bytes]`;
  }
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => sanitizeForJson(v, depth + 1));
    if (value.length > MAX_ARRAY) arr.push(`… +${value.length - MAX_ARRAY}`);
    return arr;
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "function") continue;
      out[k] = sanitizeForJson(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Loại GPS khỏi raw metadata (khi người dùng không đồng ý lưu vị trí). */
export function stripGps(raw: RawMetadata): RawMetadata {
  const copy = { ...raw };
  delete copy.gps;
  const xmp = copy.xmp;
  if (xmp && typeof xmp === "object" && !Array.isArray(xmp)) {
    copy.xmp = Object.fromEntries(Object.entries(xmp).filter(([k]) => !/^GPS/i.test(k)));
  }
  return copy;
}

/** Định dạng tốc độ màn trập: 0.004 → "1/250", 2 → "2s" */
export function formatShutter(seconds?: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  if (seconds >= 0.3) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}`;
}

/** "Canon" + "Canon EOS R6" → "Canon EOS R6"; "Apple" + "iPhone 15" → "Apple iPhone 15" */
export function cameraName(m: Pick<NormalizedMetadata, "make" | "model">): string | undefined {
  const make = m.make?.trim();
  const model = m.model?.trim();
  if (!model) return make || undefined;
  if (!make) return model;
  const brand = make.split(/\s+/)[0].toLowerCase();
  return model.toLowerCase().startsWith(brand) ? model : `${make} ${model}`;
}

/** 812 → "812 B", 20480 → "20 KB", 3.4e6 → "3.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
