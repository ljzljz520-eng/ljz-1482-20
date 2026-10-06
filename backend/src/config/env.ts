import crypto from "node:crypto";

export type EnvironmentName = "preview" | "production" | "test" | "development";

const optional = (key: string, fallback = "") => process.env[key]?.trim() || fallback;
const required = (key: string) => process.env[key]?.trim() || "";

const parseNumber = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOriginList = (value: string) =>
  value.split(",").map((item) => item.trim()).filter(Boolean);

const envName = (["preview", "production", "test", "development"] as const).find(
  (item) => item === optional("NODE_ENV", "development") || item === optional("APP_ENV", "development")
) ?? "development";

export const config = {
  env: envName as EnvironmentName,
  port: parseNumber(process.env.PORT ?? "3001", 3001),
  host: optional("HOST", "0.0.0.0"),
  apiVersion: optional("API_VERSION", "1.0.0"),
  contractVersion: optional("CONTRACT_VERSION", "2026.10.1"),
  minimumClientVersion: optional("MIN_CLIENT_VERSION", "1.0.0"),
  jwtSecret: required("JWT_SECRET"),
  callbackSecret: required("CALLBACK_SECRET"),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  redisQueuePrefix: optional("QUEUE_PREFIX", "creator-workbench"),
  exportQueueName: optional("EXPORT_QUEUE_NAME", "export-jobs"),
  s3: {
    region: optional("S3_REGION", "us-east-1"),
    endpoint: required("S3_ENDPOINT"),
    publicEndpoint: required("S3_PUBLIC_ENDPOINT"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    bucket: optional("S3_BUCKET", "creator-workbench"),
    presignTtlSeconds: parseNumber(process.env.S3_PRESIGN_TTL_SECONDS ?? "600", 600)
  },
  corsOrigins: parseOriginList(optional("CORS_ORIGIN", "http://localhost:3000,http://localhost:5173,http://localhost:4173")),
  callbackBaseUrl: optional("CALLBACK_BASE_URL", "http://localhost:3001"),
  requiredMigrations: optional("REQUIRED_MIGRATIONS", "20261006000000_init").split(",").map((item) => item.trim()).filter(Boolean),
  lockTtlMs: parseNumber(process.env.JOB_LOCK_TTL_MS ?? "90000", 90_000),
  workerId: optional("WORKER_ID", `worker-${crypto.randomBytes(4).toString("hex")}`)
};

export interface ConfigRequirement {
  key: string;
  ready: boolean;
  secret: boolean;
}

export function getConfigRequirements(): ConfigRequirement[] {
  return [
    { key: "DATABASE_URL", ready: Boolean(config.databaseUrl), secret: true },
    { key: "REDIS_URL", ready: Boolean(config.redisUrl), secret: true },
    { key: "S3_ENDPOINT", ready: Boolean(config.s3.endpoint), secret: false },
    { key: "S3_PUBLIC_ENDPOINT", ready: Boolean(config.s3.publicEndpoint), secret: false },
    { key: "S3_ACCESS_KEY_ID", ready: Boolean(config.s3.accessKeyId), secret: true },
    { key: "S3_SECRET_ACCESS_KEY", ready: Boolean(config.s3.secretAccessKey), secret: true },
    { key: "S3_BUCKET", ready: Boolean(config.s3.bucket), secret: false },
    { key: "JWT_SECRET", ready: Boolean(config.jwtSecret), secret: true },
    { key: "CALLBACK_SECRET", ready: Boolean(config.callbackSecret), secret: true },
    { key: "CORS_ORIGIN", ready: config.corsOrigins.length > 0, secret: false }
  ];
}

export function missingConfigKeys() {
  return getConfigRequirements().filter((item) => !item.ready).map((item) => item.key);
}
