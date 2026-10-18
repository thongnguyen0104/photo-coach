/**
 * Xoá toạ độ GPS ngay trong file ảnh, giữ nguyên kích thước file và các EXIF khác.
 * - EXIF (khối TIFF sau "Exif\0\0" trong JPEG/HEIC/WebP, chunk eXIf của PNG): xoá trắng GPS IFD.
 * - XMP (dạng chữ): thay giá trị các trường exif:GPS… bằng dấu cách.
 * Không đụng tới dữ liệu điểm ảnh → không giảm chất lượng.
 */

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const GPS_POINTER = 0x8825;

/** Xoá trắng GPS IFD trong một khối TIFF bắt đầu ở `start`. Trả true nếu có xoá. */
function scrubTiff(b: Uint8Array, start: number, end: number): boolean {
  if (start + 8 > end) return false;
  const le = b[start] === 0x49 && b[start + 1] === 0x49 && b[start + 2] === 0x2a && b[start + 3] === 0;
  const be = b[start] === 0x4d && b[start + 1] === 0x4d && b[start + 2] === 0 && b[start + 3] === 0x2a;
  if (!le && !be) return false;

  const inRange = (off: number, len: number) => off >= 0 && start + off + len <= end;
  const u16 = (off: number) => (le ? b[start + off] | (b[start + off + 1] << 8) : (b[start + off] << 8) | b[start + off + 1]);
  const u32 = (off: number) =>
    le
      ? (b[start + off] | (b[start + off + 1] << 8) | (b[start + off + 2] << 16)) + b[start + off + 3] * 0x1000000
      : b[start + off] * 0x1000000 + ((b[start + off + 1] << 16) | (b[start + off + 2] << 8) | b[start + off + 3]);
  const zero = (off: number, len: number) => b.fill(0, start + off, start + off + len);

  const ifd0 = u32(4);
  if (!inRange(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (!inRange(e, 12) || u16(e) !== GPS_POINTER) continue;

    const gps = u32(e + 8);
    if (!inRange(gps, 2)) return false;
    const n = u16(gps);
    for (let j = 0; j < n; j++) {
      const g = gps + 2 + j * 12;
      if (!inRange(g, 12)) break;
      const size = (TYPE_SIZE[u16(g + 2)] ?? 0) * u32(g + 4);
      if (size > 4 && inRange(u32(g + 8), size)) zero(u32(g + 8), size);
      zero(g, 12);
    }
    // IFD rỗng: số mục = 0, 4 byte kế tiếp (đã xoá) = không có IFD sau
    zero(gps, 2);
    return true;
  }
  return false;
}

const EXIF_MARK = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

function indexOf(b: Uint8Array, pattern: number[], from: number): number {
  outer: for (let i = from; i <= b.length - pattern.length; i++) {
    for (let k = 0; k < pattern.length; k++) if (b[i + k] !== pattern[k]) continue outer;
    return i;
  }
  return -1;
}

/** Thay giá trị các trường GPS trong XMP (exif:GPSLatitude="…" hoặc <exif:GPSLatitude>…<) bằng dấu cách. */
function scrubXmpText(b: Uint8Array): number {
  let text = "";
  // latin1: mỗi byte ↔ đúng 1 ký tự → vị trí trong chuỗi = vị trí byte
  for (let i = 0; i < b.length; i += 0x8000) text += String.fromCharCode(...b.subarray(i, i + 0x8000));
  let count = 0;
  for (const m of text.matchAll(/(?:exif|exifEX):GPS[A-Za-z]+/g)) {
    let p = m.index + m[0].length;
    let stop: string;
    if (text[p] === "=" && (text[p + 1] === '"' || text[p + 1] === "'")) {
      stop = text[p + 1];
      p += 2;
    } else if (text[p] === ">") {
      stop = "<";
      p += 1;
    } else continue;
    const close = text.indexOf(stop, p);
    if (close < 0 || close - p > 200) continue;
    if (close > p) {
      b.fill(0x20, p, close);
      count++;
    }
  }
  return count;
}

let crcTable: Uint32Array | undefined;
function crc32(b: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const readU32BE = (b: Uint8Array, o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

/** PNG: xoá GPS trong chunk eXIf rồi tính lại CRC cho các chunk không phải dữ liệu ảnh. */
function fixPng(b: Uint8Array): number {
  let count = 0;
  for (let p = 8; p + 12 <= b.length; ) {
    const len = readU32BE(b, p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = p + 8;
    if (data + len + 4 > b.length) break;
    if (type === "eXIf" && scrubTiff(b, data, data + len)) count++;
    if (type !== "IDAT") {
      const crc = crc32(b, p + 4, data + len);
      b[data + len] = crc >>> 24;
      b[data + len + 1] = (crc >>> 16) & 0xff;
      b[data + len + 2] = (crc >>> 8) & 0xff;
      b[data + len + 3] = crc & 0xff;
    }
    if (type === "IEND") break;
    p = data + len + 4;
  }
  return count;
}

/** Xoá GPS ngay trên mảng byte (sửa trực tiếp). Trả về số chỗ đã xoá. */
export function scrubGpsInPlace(bytes: Uint8Array): number {
  let count = 0;
  for (let i = indexOf(bytes, EXIF_MARK, 0); i >= 0; i = indexOf(bytes, EXIF_MARK, i + 6)) {
    if (scrubTiff(bytes, i + 6, bytes.length)) count++;
  }
  // WebP: chunk EXIF chứa thẳng khối TIFF (không có "Exif\0\0")
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (riff) {
    for (let p = 12; p + 8 <= bytes.length; ) {
      const len = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
      const type = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      if (type === "EXIF" && scrubTiff(bytes, p + 8, Math.min(bytes.length, p + 8 + len))) count++;
      p += 8 + len + (len & 1);
    }
  }
  count += scrubXmpText(bytes);
  if (isPng(bytes)) count += fixPng(bytes);
  return count;
}
