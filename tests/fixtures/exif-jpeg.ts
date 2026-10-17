/**
 * Tạo segment EXIF (APP1) tối giản bằng tay để test đọc metadata
 * mà không cần file ảnh mẫu thật. Định dạng TIFF little-endian.
 */

type Entry = { tag: number; type: 2 | 3 | 4 | 5; value: string | number | [number, number] | [number, number][] };

const TYPE_SIZE = { 2: 1, 3: 2, 4: 4, 5: 8 } as const;

function encodeIfd(entries: Entry[], offset: number): { bytes: Buffer; size: number } {
  entries.sort((a, b) => a.tag - b.tag);
  const headerSize = 2 + entries.length * 12 + 4;
  const head = Buffer.alloc(headerSize);
  const data: Buffer[] = [];
  let dataOffset = offset + headerSize;
  head.writeUInt16LE(entries.length, 0);

  entries.forEach((e, i) => {
    const p = 2 + i * 12;
    head.writeUInt16LE(e.tag, p);
    head.writeUInt16LE(e.type, p + 2);
    let payload: Buffer;
    let count: number;
    if (e.type === 2) {
      payload = Buffer.from(`${e.value}\0`, "ascii");
      count = payload.length;
    } else if (e.type === 5) {
      const rats = (Array.isArray((e.value as unknown[])[0]) ? e.value : [e.value]) as [number, number][];
      payload = Buffer.alloc(rats.length * 8);
      rats.forEach(([n, d], j) => {
        payload.writeUInt32LE(n, j * 8);
        payload.writeUInt32LE(d, j * 8 + 4);
      });
      count = rats.length;
    } else {
      payload = Buffer.alloc(4);
      if (e.type === 3) payload.writeUInt16LE(e.value as number, 0);
      else payload.writeUInt32LE(e.value as number, 0);
      count = 1;
    }
    head.writeUInt32LE(count, p + 4);
    if (count * TYPE_SIZE[e.type] <= 4) {
      payload.copy(head, p + 8, 0, 4);
    } else {
      head.writeUInt32LE(dataOffset, p + 8);
      if (payload.length % 2) payload = Buffer.concat([payload, Buffer.alloc(1)]);
      data.push(payload);
      dataOffset += payload.length;
    }
  });
  const bytes = Buffer.concat([head, ...data]);
  return { bytes, size: bytes.length };
}

export interface ExifOptions {
  make?: string;
  model?: string;
  exposureTime?: [number, number];
  fNumber?: [number, number];
  iso?: number;
  focalLength?: [number, number];
  focalLength35?: number;
  dateTimeOriginal?: string;
  gps?: { lat: number; lng: number };
}

const dms = (deg: number): [number, number][] => {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 100);
  return [
    [d, 1],
    [m, 1],
    [s, 100],
  ];
};

/** Trả về segment APP1 hoàn chỉnh (FFE1 + length + "Exif\0\0" + TIFF). */
export function buildExifApp1(o: ExifOptions): Buffer {
  const TIFF_HEADER = 8;
  const exifEntries: Entry[] = [];
  if (o.exposureTime) exifEntries.push({ tag: 0x829a, type: 5, value: o.exposureTime });
  if (o.fNumber) exifEntries.push({ tag: 0x829d, type: 5, value: o.fNumber });
  if (o.iso) exifEntries.push({ tag: 0x8827, type: 3, value: o.iso });
  if (o.dateTimeOriginal) exifEntries.push({ tag: 0x9003, type: 2, value: o.dateTimeOriginal });
  if (o.focalLength) exifEntries.push({ tag: 0x920a, type: 5, value: o.focalLength });
  if (o.focalLength35) exifEntries.push({ tag: 0xa405, type: 3, value: o.focalLength35 });

  const gpsEntries: Entry[] = o.gps
    ? [
        { tag: 0x0001, type: 2, value: o.gps.lat >= 0 ? "N" : "S" },
        { tag: 0x0002, type: 5, value: dms(o.gps.lat) },
        { tag: 0x0003, type: 2, value: o.gps.lng >= 0 ? "E" : "W" },
        { tag: 0x0004, type: 5, value: dms(o.gps.lng) },
      ]
    : [];

  // IFD0 trước để biết kích thước, rồi tính offset cho Exif IFD và GPS IFD
  const ifd0Base: Entry[] = [];
  if (o.make) ifd0Base.push({ tag: 0x010f, type: 2, value: o.make });
  if (o.model) ifd0Base.push({ tag: 0x0110, type: 2, value: o.model });
  ifd0Base.push({ tag: 0x8769, type: 4, value: 0 });
  if (gpsEntries.length) ifd0Base.push({ tag: 0x8825, type: 4, value: 0 });

  const ifd0Size = encodeIfd([...ifd0Base], TIFF_HEADER).size;
  const exifOffset = TIFF_HEADER + ifd0Size;
  const exifIfd = encodeIfd(exifEntries, exifOffset);
  const gpsOffset = exifOffset + exifIfd.size;
  const gpsIfd = gpsEntries.length ? encodeIfd(gpsEntries, gpsOffset) : null;

  const ifd0 = encodeIfd(
    ifd0Base.map((e) => (e.tag === 0x8769 ? { ...e, value: exifOffset } : e.tag === 0x8825 ? { ...e, value: gpsOffset } : e)),
    TIFF_HEADER,
  );

  const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const tiff = Buffer.concat([tiffHeader, ifd0.bytes, exifIfd.bytes, ...(gpsIfd ? [gpsIfd.bytes] : [])]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, payload]);
}

/** Chèn APP1 EXIF ngay sau SOI của một file JPEG có sẵn. */
export function injectExif(jpeg: Buffer, app1: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Not a JPEG");
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** JPEG "rỗng" chỉ gồm SOI + APP1 + EOI — đủ để exifr đọc metadata. */
export function exifOnlyJpeg(o: ExifOptions): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), buildExifApp1(o), Buffer.from([0xff, 0xd9])]);
}
