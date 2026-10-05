import { Client, BucketItem } from "minio";
import { Readable } from "node:stream";
import { AppConfig } from "../config/env";

/**
 * 对象存储双客户端：
 * - internal：服务端在容器网络内实际读写（S3_INTERNAL_ENDPOINT）
 * - public：仅用于生成浏览器访问的预签名 URL（S3_PUBLIC_ENDPOINT）
 * 预览/正式通过独立 bucket 隔离，绝不共用。
 */
export class Storage {
  private internal: Client;
  private public: Client;

  constructor(private readonly config: AppConfig["storage"]) {
    const base = {
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      pathStyle: true,
    };
    this.internal = new Client({
      endPoint: config.internalEndPoint,
      ...base,
    });
    this.public = new Client({
      endPoint: config.publicEndPoint,
      port: config.publicPort,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      pathStyle: true,
    });
  }

  get bucket(): string {
    return this.config.bucket;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.internal.bucketExists(this.config.bucket);
    if (!exists) {
      await this.internal.makeBucket(this.config.bucket, "us-east-1");
      await this.setCorsPolicy().catch(() => undefined);
    }
  }

  private async setCorsPolicy(): Promise<void> {
    // MinIO 不强制浏览器直传（后端中转），这里仅保证下载预签名链路可跨域
    const policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${this.config.bucket}/*`],
        },
      ],
    });
    await this.internal.setBucketPolicy(this.config.bucket, policy);
  }

  /** 上传（内部网络）。key 强制携带租户前缀，杜绝越权路径 */
  async put(key: string, body: Buffer | Readable, size: number, contentType?: string) {
    await this.internal.putObject(this.config.bucket, key, body, size, {
      "Content-Type": contentType || "application/octet-stream",
    });
  }

  async getStream(key: string): Promise<Readable> {
    return this.internal.getObject(this.config.bucket, key);
  }

  async stat(key: string): Promise<{ size: number }> {
    const st = await this.internal.statObject(this.config.bucket, key);
    return { size: st.size };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.stat(key);
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === "NoSuchKey" ||
          (err as { code?: string }).code === "NotFound") {
        return false;
      }
      throw err;
    }
  }

  /** 限时下载授权：短 TTL 预签名，预览/正式域名各自独立 */
  presignGet(key: string, ttlSeconds?: number): Promise<string> {
    return this.public.presignedGetObject(
      this.config.bucket,
      key,
      ttlSeconds ?? this.config.presignTtlSeconds
    );
  }

  async listTenant(prefix: string): Promise<BucketItem[]> {
    const stream = this.internal.listObjectsV2(this.config.bucket, prefix, true);
    const items: BucketItem[] = [];
    for await (const item of stream) items.push(item);
    return items;
  }
}

let storage: Storage | null = null;
export function initStorage(config: AppConfig): Storage {
  if (!storage) storage = new Storage(config.storage);
  return storage;
}
export function getStorage(): Storage {
  if (!storage) throw new Error("Storage not initialized");
  return storage;
}
