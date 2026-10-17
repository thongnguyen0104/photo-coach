import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENV_FILE = path.join(ROOT, '.env.local');

const c = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
export const green = c(32);
export const red = c(31);
export const yellow = c(33);
export const gray = c(90);
export const bold = c(1);

export const ok = (msg) => console.log(`  ${green('✔')} ${msg}`);
export const bad = (msg) => console.log(`  ${red('✘')} ${msg}`);
export const warn = (msg) => console.log(`  ${yellow('!')} ${msg}`);
export const info = (msg) => console.log(`  ${gray('·')} ${gray(msg)}`);

export function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.log(red(`Không tìm thấy ${ENV_FILE}`));
    console.log('Hãy copy file .env.example thành .env.local rồi điền giá trị (xem docs/PHASE0-SETUP.md).');
    process.exit(1);
  }
  process.loadEnvFile(ENV_FILE);
  return process.env;
}

/** Che bớt bí mật khi in ra màn hình. */
export function mask(value) {
  if (!value) return '(trống)';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

/** Trả về danh sách tên biến còn trống. */
export function missing(env, keys) {
  return keys.filter((k) => !env[k] || !env[k].trim());
}

export const OCI_KEYS = ['OCI_NAMESPACE', 'OCI_REGION', 'OCI_BUCKET', 'OCI_ACCESS_KEY_ID', 'OCI_SECRET_ACCESS_KEY'];

export function ociEndpoint(env) {
  return (
    env.OCI_S3_ENDPOINT?.trim() ||
    `https://${env.OCI_NAMESPACE.trim()}.compat.objectstorage.${env.OCI_REGION.trim()}.oraclecloud.com`
  );
}

/** S3 client trỏ vào Oracle Object Storage (S3 Compatibility API). */
export function makeS3(env) {
  return new S3Client({
    region: env.OCI_REGION.trim(),
    endpoint: ociEndpoint(env),
    // OCI yêu cầu path-style: https://<endpoint>/<bucket>/<key>
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.OCI_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.OCI_SECRET_ACCESS_KEY.trim(),
    },
    // AWS SDK mới tự thêm checksum CRC32 mà nhiều dịch vụ S3-compatible chưa hỗ trợ
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
