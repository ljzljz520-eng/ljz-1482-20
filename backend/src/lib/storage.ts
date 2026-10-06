import {
  CopyObjectCommand,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { config } from "../config/env.js";

const internalClient = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

const publicClient = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.publicEndpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

export async function ensureBucketReady() {
  try {
    await internalClient.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await internalClient.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }

  await internalClient.send(new PutBucketCorsCommand({
    Bucket: config.s3.bucket,
    CORSConfiguration: {
      CORSRules: [{
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
        AllowedOrigins: config.corsOrigins.length ? config.corsOrigins : ["*"],
        ExposeHeaders: ["ETag", "Content-Length"],
        MaxAgeSeconds: 3600
      }]
    }
  }));
}

export async function headObject(key: string) {
  return internalClient.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

export async function putObject(key: string, body: Buffer | Readable | string, contentType = "application/octet-stream") {
  return internalClient.send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
}

export async function getObject(key: string) {
  return internalClient.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

export async function listObjects(prefix: string) {
  return internalClient.send(new ListObjectsV2Command({ Bucket: config.s3.bucket, Prefix: prefix }));
}

export async function copyObject(sourceKey: string, targetKey: string) {
  return internalClient.send(new CopyObjectCommand({
    Bucket: config.s3.bucket,
    Key: targetKey,
    CopySource: `/${config.s3.bucket}/${encodeURIComponent(sourceKey)}`
  }));
}

export async function createUploadUrl(key: string, contentType: string) {
  return getSignedUrl(publicClient, new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: contentType
  }), { expiresIn: config.s3.presignTtlSeconds });
}

export async function createDownloadUrl(key: string, responseContentDisposition?: string) {
  return getSignedUrl(publicClient, new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ResponseContentDisposition: responseContentDisposition
  }), { expiresIn: config.s3.presignTtlSeconds });
}

export async function storageProbe() {
  const started = Date.now();
  const key = `system/probes/${new Date().toISOString()}.txt`;
  await putObject(key, `probe ${started}`, "text/plain");
  await headObject(key);
  const url = await createDownloadUrl(key, "attachment");
  return { latencyMs: Date.now() - started, bucket: config.s3.bucket, key, url };
}
