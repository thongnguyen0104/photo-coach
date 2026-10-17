// Phase 0 — kiểm tra từng dịch vụ đã cấu hình đúng chưa.
//   npm run check                    → kiểm tra tất cả
//   npm run check -- oci             → chỉ 1 dịch vụ: neon | gemini | google | oci
//   npm run check -- gemini anh.jpg  → thêm test Gemini "nhìn" 1 tấm ảnh thật
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GoogleGenAI } from '@google/genai';
import { neon } from '@neondatabase/serverless';
import { loadEnv, missing, mask, makeS3, ociEndpoint, OCI_KEYS, ok, bad, warn, info, bold, green, red, yellow } from './lib.mjs';

const env = loadEnv();
const only = process.argv[2]?.toLowerCase();
const imagePath = process.argv[3];

/** status: 'pass' | 'fail' | 'skip' */
const summary = [];

async function section(key, title, requiredKeys, fn) {
  if (only && only !== key) return;
  console.log(`\n${bold(title)}`);
  const empty = missing(env, requiredKeys);
  if (empty.length) {
    warn(`Chưa cấu hình: ${empty.join(', ')} → bỏ qua`);
    summary.push([title, 'skip']);
    return;
  }
  try {
    await fn();
    summary.push([title, 'pass']);
  } catch (err) {
    bad(err?.message || String(err));
    if (err?.hint) info(err.hint);
    summary.push([title, 'fail']);
  }
}

function fail(message, hint) {
  const err = new Error(message);
  err.hint = hint;
  return err;
}

// ---------------------------------------------------------------- Neon
await section('neon', '1. Neon Postgres', ['DATABASE_URL'], async () => {
  const url = env.DATABASE_URL.trim();
  if (url.startsWith('psql')) {
    throw fail('DATABASE_URL đang là cả câu lệnh psql.', "Chỉ copy phần trong dấu nháy: postgresql://... (bỏ chữ psql và dấu ')");
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw fail('DATABASE_URL phải bắt đầu bằng postgresql://');
  }
  if (!url.includes('sslmode=require')) warn('Nên có ?sslmode=require ở cuối chuỗi kết nối');
  if (!url.includes('-pooler')) warn('Nên dùng chuỗi "Pooled connection" (có chữ -pooler) cho Vercel');

  const sql = neon(url);
  const [row] = await sql`select version() as version, now() as now`;
  ok(`Kết nối thành công: ${row.version.split(' on ')[0]}`);
  info(`Giờ server DB: ${new Date(row.now).toISOString()}`);
});

// ---------------------------------------------------------------- Gemini
await section('gemini', '2. Google Gemini', ['GEMINI_API_KEY'], async () => {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
  const model = env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';

  const flash = [];
  try {
    const pager = await ai.models.list();
    for await (const m of pager) {
      const name = m.name?.replace(/^models\//, '');
      if (name?.includes('flash') && !name.includes('tts') && !name.includes('image')) flash.push(name);
    }
  } catch (err) {
    throw fail(`API key không hợp lệ hoặc bị chặn: ${err.message}`, 'Tạo lại key ở https://aistudio.google.com/apikey');
  }
  ok(`API key hợp lệ (${mask(env.GEMINI_API_KEY)})`);
  info(`Các model Flash khả dụng: ${flash.slice(0, 12).join(', ') || '(không liệt kê được)'}`);

  const res = await ai.models.generateContent({
    model,
    contents: 'Trả về JSON {"hello": "<một câu chào ngắn bằng tiếng Việt>"}',
    config: { responseMimeType: 'application/json' },
  });
  const parsed = JSON.parse(res.text);
  ok(`Model "${model}" trả JSON được: ${JSON.stringify(parsed)}`);

  if (imagePath) {
    const file = path.resolve(process.cwd(), imagePath);
    const ext = path.extname(file).toLowerCase();
    const mimeType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
    if (!mimeType) throw fail('Chỉ test được ảnh .jpg/.jpeg/.png/.webp');
    const data = fs.readFileSync(file).toString('base64');
    const vision = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data } },
            { text: 'Bạn là thầy dạy chụp ảnh. Khen 1 điểm thật sự tốt của ảnh này, rồi góp ý 1 điểm theo kiểu khen trước chê sau. Tối đa 3 câu.' },
          ],
        },
      ],
    });
    ok('Gemini nhìn ảnh được. Nhận xét thử:');
    console.log(`\n    ${vision.text.trim().replace(/\n/g, '\n    ')}\n`);
  } else {
    info('Mẹo: chạy `npm run check -- gemini duong-dan-anh.jpg` để thử Gemini nhận xét 1 tấm ảnh thật.');
  }
});

// ---------------------------------------------------------------- Google OAuth + AUTH_SECRET
await section('google', '3. Google OAuth + AUTH_SECRET', ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'], async () => {
  const id = env.AUTH_GOOGLE_ID.trim();
  const secret = env.AUTH_GOOGLE_SECRET.trim();
  if (!id.endsWith('.apps.googleusercontent.com')) {
    throw fail('AUTH_GOOGLE_ID sai định dạng', 'Client ID phải kết thúc bằng .apps.googleusercontent.com');
  }
  ok(`Client ID đúng định dạng (${mask(id)})`);
  if (!secret.startsWith('GOCSPX-')) warn('Client Secret thường bắt đầu bằng GOCSPX- — kiểm tra lại có copy nhầm không');
  else ok(`Client Secret đúng định dạng (${mask(secret)})`);
  info('Đăng nhập thật sẽ được test ở Phase 1 khi có app chạy ở http://localhost:3000');
});

if (!only || only === 'google') {
  if (!env.AUTH_SECRET?.trim()) {
    warn('AUTH_SECRET còn trống. Copy dòng dưới vào .env.local:');
    console.log(`\n    AUTH_SECRET=${crypto.randomBytes(32).toString('base64')}\n`);
  } else {
    ok('AUTH_SECRET đã có');
  }
}

// ---------------------------------------------------------------- Oracle Object Storage
await section('oci', '4. Oracle Cloud Object Storage', OCI_KEYS, async () => {
  const s3 = makeS3(env);
  const Bucket = env.OCI_BUCKET.trim();
  info(`Endpoint: ${ociEndpoint(env)}`);

  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404) throw fail(`Không thấy bucket "${Bucket}"`, 'Kiểm tra OCI_BUCKET, OCI_NAMESPACE, OCI_REGION (region phải là region chứa bucket).');
    if (code === 403 || code === 401) {
      throw fail(
        `Oracle từ chối truy cập (HTTP ${code})`,
        'Kiểm tra lần lượt: OCI_NAMESPACE đúng chưa → Access key/Secret key có copy đủ không (Secret chỉ hiện 1 lần lúc tạo, mất thì tạo key mới).',
      );
    }
    throw fail(`Không kết nối được: ${err.name} ${err.message}`, 'Kiểm tra OCI_NAMESPACE và OCI_REGION (vd ap-singapore-1).');
  }
  ok(`Bucket "${Bucket}" truy cập được bằng S3 API`);

  const key = `spike/check-${Date.now()}.txt`;
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: 'xin chao', ContentType: 'text/plain' }));
  const got = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  const text = await got.Body.transformToString();
  if (text !== 'xin chao') throw fail('Đọc lại file không khớp nội dung');
  ok('Ghi + đọc file từ server: OK');

  // Pre-signed URL — cách browser sẽ upload ở Phase 1
  const presignedKey = `spike/presigned-${Date.now()}.txt`;
  const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: presignedKey, ContentType: 'text/plain' }), { expiresIn: 300 });
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'presigned' });
  if (!put.ok) throw fail(`Upload bằng pre-signed URL lỗi HTTP ${put.status}: ${(await put.text()).slice(0, 300)}`);
  ok('Upload bằng pre-signed URL (từ Node): OK');

  // Giả lập "preflight" mà trình duyệt gửi trước khi upload (CORS)
  const preflight = await fetch(putUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const allowOrigin = preflight.headers.get('access-control-allow-origin');
  const allowMethods = preflight.headers.get('access-control-allow-methods');
  info(`Preflight CORS → HTTP ${preflight.status}, allow-origin=${allowOrigin ?? '(không có)'}, allow-methods=${allowMethods ?? '(không có)'}`);
  if (allowOrigin === '*' || allowOrigin === 'http://localhost:3000') {
    ok('Có vẻ OCI cho phép upload từ trình duyệt. Xác nhận lại bằng `npm run cors`.');
  } else {
    warn('Preflight không trả header CORS → có thể trình duyệt sẽ bị chặn. Chạy `npm run cors` để xác nhận.');
  }

  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
  await s3.send(new DeleteObjectCommand({ Bucket, Key: presignedKey }));
  ok('Xoá file test: OK');
});

// ---------------------------------------------------------------- Tổng kết
console.log(`\n${bold('Tổng kết')}`);
const icon = { pass: green('✔ OK'), fail: red('✘ LỖI'), skip: yellow('– chưa cấu hình') };
for (const [title, status] of summary) console.log(`  ${icon[status]}  ${title}`);
if (summary.some(([, s]) => s === 'fail')) process.exitCode = 1;
