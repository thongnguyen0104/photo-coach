import crypto from "node:crypto";

const secret = () => process.env.AUTH_SECRET || "dev-insecure-secret";

const sign = (op: string, key: string, exp: number) =>
  crypto.createHmac("sha256", secret()).update(`${op}:${key}:${exp}`).digest("base64url");

export function signStorageUrl(op: "put" | "get", key: string, expiresInSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `/api/local-storage/${path}?op=${op}&exp=${exp}&sig=${sign(op, key, exp)}`;
}

export function verifyStorageSignature(op: string, key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(op, key, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
