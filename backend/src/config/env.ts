import { Logger } from "pino";

export type AppEnv = "production" | "preview" | "test";

export interface AppConfig {
  env: AppEnv;
  port: number;
  publicBaseUrl: string;
  buildSha: string;
  /** 语义化版本：自检页展示版本兼容性 */
  apiVersion: string;
  /** 允许的最低前端版本，低于该版本自检会报 INCOMPATIBLE */
  minClientVersion: string;
  jwtSecret: string;
  corsOrigins: string[];
  databaseUrl: string;
  migrationLevel: "latest" | "pending" | string;
  storage: {
    endPoint: string;
    internalEndPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicEndPoint: string;
    publicPort: number;
    presignTtlSeconds: number;
  };
  queue: {
    pollIntervalMs: number;
    leaseMs: number;
    heartbeatMs: number;
    maxAttempts: number;
  };
  /** 演练用：导出任务额外耗时，验证部署换版在途任务续接 */
  exportDelayMs: number;
  workerName: string;
}

export interface ConfigResult {
  config: AppConfig | null;
  /** 启动期致命缺失项（不区分密钥，仅变量名） */
  missing: string[];
  errors: string[];
}

const BOOL = (v: string | undefined, d = false) =>
  v === undefined ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());

const NUM = (v: string | undefined, d: number) => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const missing: string[] = [];
  const errors: string[] = [];
  const require = (name: string): string => {
    const v = env[name];
    if (!v || v.trim() === "") {
      missing.push(name);
      return "";
    }
    return v.trim();
  };

  const rawEnv = (env.APP_ENV ?? "preview").toLowerCase();
  const appEnv: AppEnv =
    rawEnv === "production" ? "production" : rawEnv === "test" ? "test" : "preview";

  const jwtSecret = require("JWT_SECRET");
  const databaseUrl = require("DATABASE_URL");
  const storageEndPoint = require("S3_ENDPOINT");
  const s3AccessKey = require("S3_ACCESS_KEY");
  const s3SecretKey = require("S3_SECRET_KEY");
  const publicBaseUrl = require("PUBLIC_BASE_URL");
  const s3PublicEndpoint = env.S3_PUBLIC_ENDPOINT ?? storageEndPoint;
  const s3Port = NUM(env.S3_PORT, 9000);

  const defaultBucket =
    appEnv === "production"
      ? "workbench-prod"
      : appEnv === "test"
      ? "workbench-test"
      : "workbench-preview";

  const config: AppConfig = {
    env: appEnv,
    port: NUM(env.PORT, 8000),
    publicBaseUrl,
    buildSha: (env.BUILD_SHA ?? "dev").slice(0, 12),
    apiVersion: env.API_VERSION ?? "1.4.0",
    minClientVersion: env.MIN_CLIENT_VERSION ?? "1.4.0",
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl,
    migrationLevel: env.MIGRATION_LEVEL ?? "latest",
    storage: {
      endPoint: storageEndPoint,
      internalEndPoint: env.S3_INTERNAL_ENDPOINT || storageEndPoint,
      port: s3Port,
      useSSL: BOOL(env.S3_USE_SSL, false),
      accessKey: s3AccessKey,
      secretKey: s3SecretKey,
      bucket: env.S3_BUCKET || defaultBucket,
      publicEndPoint: s3PublicEndpoint,
      publicPort: NUM(env.S3_PUBLIC_PORT, s3Port),
      presignTtlSeconds: NUM(env.S3_PRESIGN_TTL_SECONDS, 300),
    },
    queue: {
      pollIntervalMs: NUM(env.QUEUE_POLL_INTERVAL_MS, 1000),
      leaseMs: NUM(env.QUEUE_LEASE_MS, 30000),
      heartbeatMs: NUM(env.QUEUE_HEARTBEAT_MS, 10000),
      maxAttempts: NUM(env.QUEUE_MAX_ATTEMPTS, 3),
    },
    exportDelayMs: NUM(env.EXPORT_DELAY_MS, 0),
    workerName: env.WORKER_NAME || `worker-${process.pid}`,
  };

  if (config.publicBaseUrl && !/^https?:\/\/.+/.test(config.publicBaseUrl)) {
    errors.push("PUBLIC_BASE_URL 必须是 http(s) 绝对地址（上传回调/下载授权依赖它）");
  }
  if (config.corsOrigins.length === 0) {
    errors.push("CORS_ORIGINS 未配置：生产/预览必须显式声明允许的浏览器来源");
  }

  return { config, missing, errors };
}

/** 敏感配置清单：自检页只展示 ready/missing，不允许把值发给浏览器 */
export function secretReadiness(config: AppConfig | null): Record<string, boolean> {
  return {
    JWT_SECRET: !!config?.jwtSecret,
    DATABASE_URL: !!config?.databaseUrl,
    S3_ACCESS_KEY: !!config?.storage.accessKey,
    S3_SECRET_KEY: !!config?.storage.secretKey,
  };
}

/** 非敏感的环境标识，可下发浏览器 */
export function publicRuntimeInfo(config: AppConfig) {
  return {
    env: config.env,
    apiVersion: config.apiVersion,
    minClientVersion: config.minClientVersion,
    buildSha: config.buildSha,
    worker: config.workerName,
    storageBucketIsolated: config.storage.bucket,
    callbackBase: config.publicBaseUrl,
    presignTtlSeconds: config.storage.presignTtlSeconds,
  };
}

export function logConfigErrors(result: ConfigResult, log: Logger) {
  for (const name of result.missing) {
    log.error({ envVar: name }, "必需环境变量缺失");
  }
  for (const err of result.errors) {
    log.error({ reason: err }, "环境配置非法");
  }
}
