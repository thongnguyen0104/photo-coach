// Phase 0 — spike: trình duyệt có upload THẲNG lên Oracle Object Storage được không (CORS)?
//   npm run cors  → mở http://localhost:3000 trên trình duyệt
import http from 'node:http';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv, missing, makeS3, OCI_KEYS, bold, red } from './lib.mjs';

const env = loadEnv();
const empty = missing(env, OCI_KEYS);
if (empty.length) {
  console.log(red(`Chưa cấu hình Oracle: ${empty.join(', ')}`));
  process.exit(1);
}

const s3 = makeS3(env);
const Bucket = env.OCI_BUCKET.trim();
const PORT = 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }

    if (url.pathname === '/api/presign') {
      const type = url.searchParams.get('type') || 'application/octet-stream';
      const name = (url.searchParams.get('name') || 'file').replace(/[^\w.-]/g, '_');
      const key = `spike/${Date.now()}-${name}`;
      const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: type }), { expiresIn: 600 });
      const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 600 });
      return json(200, { key, putUrl, getUrl });
    }

    if (url.pathname === '/api/delete' && req.method === 'POST') {
      const key = url.searchParams.get('key') || '';
      if (!key.startsWith('spike/')) return json(400, { error: 'Chỉ xoá file trong spike/' });
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
      return json(200, { deleted: key });
    }

    json(404, { error: 'not found' });
  } catch (err) {
    json(500, { error: err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(red(`Cổng ${PORT} đang bị chiếm. Tắt app khác đang chạy ở cổng ${PORT} rồi thử lại.`));
  else console.log(red(err.message));
  process.exit(1);
});

server.listen(PORT, 'localhost', () => {
  console.log(bold(`\nMở trình duyệt: http://localhost:${PORT}`));
  console.log('Nhấn Ctrl + C để dừng.\n');
});

const PAGE = /* html */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test upload Oracle (CORS)</title>
<style>
  :root { color-scheme: light dark; --ok: #16a34a; --bad: #dc2626; --muted: #6b7280; }
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  section { border: 1px solid #8884; border-radius: 10px; padding: 16px; margin: 16px 0; }
  button { padding: 8px 14px; border-radius: 8px; border: 1px solid #8886; cursor: pointer; font: inherit; }
  input[type=text] { width: 100%; padding: 8px; box-sizing: border-box; font: inherit; }
  #log { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 13px; background: #8881; padding: 12px; border-radius: 8px; min-height: 80px; }
  .ok { color: var(--ok); } .bad { color: var(--bad); } .muted { color: var(--muted); }
  img { max-width: 100%; max-height: 300px; margin-top: 8px; border-radius: 8px; }
</style>
</head>
<body>
<h1>Phase 0 — Test upload thẳng từ trình duyệt lên Oracle</h1>
<p class="muted">Chọn 1 tấm ảnh bất kỳ rồi bấm Test A. Kết quả hiện ở khung bên dưới.</p>

<section>
  <p><input type="file" id="file" accept="image/*"></p>
  <button id="testA">Test A: Upload bằng S3 pre-signed URL</button>
  <button id="cleanup" disabled>Xoá file test</button>
  <div id="preview"></div>
</section>

<section>
  <strong>Test B (chỉ làm nếu Test A thất bại):</strong> Pre-Authenticated Request (PAR)
  <p class="muted">Tạo PAR trong Oracle Console theo hướng dẫn Bước 9 (docs/PHASE0-SETUP.md), dán URL vào đây.</p>
  <input type="text" id="par" placeholder="https://objectstorage.ap-singapore-1.oraclecloud.com/p/.../n/.../b/.../o/">
  <p><button id="testB">Test B: Upload bằng PAR</button></p>
</section>

<div id="log"></div>

<script>
const $ = (id) => document.getElementById(id);
const log = (msg, cls = '') => { $('log').innerHTML += '<div class="' + cls + '">' + msg + '</div>'; };
let uploadedKey = null;

function pickFile() {
  const f = $('file').files[0];
  if (!f) { log('⚠ Hãy chọn 1 file ảnh trước.', 'bad'); return null; }
  return f;
}

function explain(err) {
  if (err instanceof TypeError) {
    log('✘ Trình duyệt chặn request — gần như chắc chắn là lỗi CORS.', 'bad');
    log('  Bấm F12 → tab Console để xem dòng lỗi màu đỏ, copy gửi lại cho Claude.', 'muted');
  } else {
    log('✘ ' + err.message, 'bad');
  }
}

$('testA').onclick = async () => {
  const f = pickFile(); if (!f) return;
  $('log').innerHTML = '';
  try {
    log('1/3 Xin pre-signed URL từ server…');
    const r = await fetch('/api/presign?type=' + encodeURIComponent(f.type) + '&name=' + encodeURIComponent(f.name));
    const { key, putUrl, getUrl, error } = await r.json();
    if (error) throw new Error(error);

    log('2/3 Upload ' + (f.size / 1024 / 1024).toFixed(2) + ' MB thẳng lên Oracle…');
    const t = performance.now();
    const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': f.type }, body: f });
    if (!put.ok) throw new Error('Oracle trả HTTP ' + put.status + ': ' + (await put.text()).slice(0, 300));
    uploadedKey = key; $('cleanup').disabled = false;
    log('✔ UPLOAD OK trong ' + Math.round(performance.now() - t) + ' ms → CORS cho PUT hoạt động!', 'ok');

    log('3/3 Đọc lại file bằng fetch (cần cho tính năng crop/preview ở Phase 1)…');
    $('preview').innerHTML = '<img src="' + getUrl + '" alt="ảnh vừa upload">';
    try {
      const get = await fetch(getUrl);
      if (!get.ok) throw new Error('HTTP ' + get.status);
      await get.blob();
      log('✔ ĐỌC LẠI OK → CORS cho GET hoạt động!', 'ok');
    } catch (e) {
      log('! Upload được nhưng fetch đọc lại bị chặn. Ảnh vẫn hiển thị bằng thẻ <img>, chỉ ảnh hưởng tính năng vẽ canvas — báo lại cho Claude.', 'bad');
    }
    log('\\n🎉 KẾT LUẬN: Dùng được cách upload thẳng lên Oracle. Báo cho Claude: "Test A OK".', 'ok');
  } catch (err) { explain(err); log('\\n→ Thử tiếp Test B bên trên.', 'muted'); }
};

$('testB').onclick = async () => {
  const f = pickFile(); if (!f) return;
  let base = $('par').value.trim();
  if (!base) { log('⚠ Dán URL PAR trước.', 'bad'); return; }
  if (!base.endsWith('/')) base += '/';
  $('log').innerHTML = '';
  try {
    log('Upload bằng PAR…');
    const put = await fetch(base + 'spike/par-' + Date.now() + '-' + encodeURIComponent(f.name), { method: 'PUT', body: f });
    if (!put.ok) throw new Error('Oracle trả HTTP ' + put.status + ': ' + (await put.text()).slice(0, 300));
    log('✔ PAR upload OK → báo cho Claude: "Test B OK". Nhớ xoá PAR sau khi test xong (Bước 9).', 'ok');
  } catch (err) { explain(err); log('\\n→ Báo lại cho Claude: "Test A và B đều lỗi" để chuyển phương án dự phòng.', 'muted'); }
};

$('cleanup').onclick = async () => {
  if (!uploadedKey) return;
  const r = await fetch('/api/delete?key=' + encodeURIComponent(uploadedKey), { method: 'POST' });
  const j = await r.json();
  log(j.deleted ? '✔ Đã xoá ' + j.deleted : '✘ ' + j.error, j.deleted ? 'ok' : 'bad');
  uploadedKey = null; $('cleanup').disabled = true; $('preview').innerHTML = '';
};
</script>
</body>
</html>`;
