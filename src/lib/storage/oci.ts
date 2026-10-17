import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage } from "./index";

/** Oracle Cloud Object Storage qua S3 Compatibility API. */
export function createOciStorage(): Storage {
  const env = (k: string) => process.env[k]!.trim();
  const endpoint =
    process.env.OCI_S3_ENDPOINT?.trim() ||
    `https://${env("OCI_NAMESPACE")}.compat.objectstorage.${env("OCI_REGION")}.oraclecloud.com`;
  const Bucket = env("OCI_BUCKET");

  const s3 = new S3Client({
    region: env("OCI_REGION"),
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env("OCI_ACCESS_KEY_ID"), secretAccessKey: env("OCI_SECRET_ACCESS_KEY") },
    // AWS SDK mới tự thêm checksum CRC32 mà OCI chưa hỗ trợ
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    async presignPut(key, contentType, expiresInSec = 600) {
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
        expiresIn: expiresInSec,
      });
      return { url, method: "PUT", headers: { "Content-Type": contentType } };
    },
    presignGet(key, expiresInSec = 3600) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresInSec });
    },
    async getBytes(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return res.Body!.transformToByteArray();
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
