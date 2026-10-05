import { createHash } from "node:crypto";
import { Pool } from "pg";
import { AppConfig, secretReadiness } from "../config/env";
import { getStorage } from "../storage/client";
import { JobQueue } from "../queue/jobs";
import { AssetRepo, ProjectRepo } from "../db/repos";
import { migrationStatus } from "../db/migrate";
import { isCompatible } from "./version";

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  key: string;
  label: string;
  status: CheckStatus;
  /** 面向运维的结论，不含任何密钥值 */
  detail: string;
  /** fail 时给出不改代码的修复指引（变量名/操作步骤） */
  remediation?: string;
  meta?: Record<string, unknown>;
}

const ok = (r: Omit<CheckResult, "status">): CheckResult => ({ ...r, status: "pass" });
const fail = (r: Omit<CheckResult, "status">): CheckResult => ({ ...r, status: "fail" });
const warn = (r: Omit<CheckResult, "status">): CheckResult => ({ ...r, status: "warn" });

export function checkVersion(config: AppConfig, clientVersion: string | undefined): CheckResult {
  const compatible = isCompatible(clientVersion, config.minClientVersion);
  return compatible
    ? ok({
        key: "version",
        label: "版本兼容",
        detail: `前端 ${clientVersion ?? "(未上报)"} 与 API ${config.apiVersion} 兼容（最低 ${config.minClientVersion}）`,
        meta: {
          clientVersion: clientVersion ?? null,
          apiVersion: config.apiVersion,
          minClientVersion: config.minClientVersion,
        },
      })
    : fail({
        key: "version",
        label: "版本兼容",
        detail: `前端 ${clientVersion ?? "(未上报)"} 低于最低兼容版本 ${config.minClientVersion}`,
        remediation: "部署与该 API 匹配的前端版本，或调整 MIN_CLIENT_VERSION 后重新部署（需走回退流程）。",
        meta: {
          clientVersion: clientVersion ?? null,
          apiVersion: config.apiVersion,
          minClientVersion: config.minClientVersion,
        },
      });
}

export function checkConfigReadiness(config: AppConfig | null, missing: string[], errors: string[]): CheckResult {
  const secrets = secretReadiness(config);
  const allReady = Object.values(secrets).every(Boolean) && missing.length === 0 && errors.length === 0;
  return allReady
    ? ok({
        key: "config",
        label: "敏感配置就绪",
        detail: "JWT、数据库、对象存储密钥均已就绪（仅展示布尔状态，不回传任何值）",
        meta: { secrets, missing: [], errors: [] },
      })
    : fail({
        key: "config",
        label: "敏感配置就绪",
        detail: `存在未就绪配置：${[...missing, ...errors].join("；") || "密钥缺失"}`,
        remediation: "在部署平台环境变量中补齐缺失项后重启，详见 docs/DEPLOYMENT.md「环境变量清单」。",
        meta: { secrets, missing, errors },
      });
}

export async function checkDatabase(pool: Pool): Promise<CheckResult> {
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    const latencyMs = Date.now() - start;
    const status = await migrationStatus(pool);
    if (!status.complete) {
      return fail({
        key: "database",
        label: "关系数据库 & 迁移",
        detail: `数据库可连接，但有 ${status.pending.length} 个迁移未执行（当前 ${status.latestVersion ?? "空库"}）`,
        remediation: "执行 `npm run migrate`（容器：`docker compose run --rm backend migrate`）后再验收。",
        meta: {
          connected: true,
          latencyMs,
          pending: status.pending.map((p) => p.version),
          applied: status.applied,
        },
      });
    }
    return ok({
      key: "database",
      label: "关系数据库 & 迁移",
      detail: `连接正常（${latencyMs}ms），迁移完整（最新 ${status.latestVersion}）`,
      meta: { connected: true, latencyMs, applied: status.applied, pending: [] },
    });
  } catch (err) {
    return fail({
      key: "database",
      label: "关系数据库 & 迁移",
      detail: `数据库不可用：${(err as Error).message}`,
      remediation: "检查 DATABASE_URL、数据库容器/实例状态及网络可达性（容器间使用服务名 db）。",
      meta: { connected: false },
    });
  }
}

export async function checkStorage(config: AppConfig): Promise<CheckResult> {
  const storage = getStorage();
  try {
    await storage.ensureBucket();
    const probeKey = `_probe/${config.env}/readiness-${process.pid}.txt`;
    const payload = Buffer.from(`ready ${new Date().toISOString()}`);
    await storage.put(probeKey, payload, payload.length, "text/plain");
    const exists = await storage.exists(probeKey);
    if (!exists) throw new Error("写入后无法读回对象");
    return ok({
      key: "storage",
      label: "对象存储",
      detail: `桶 ${storage.bucket} 读写正常（${config.env} 环境独立隔离）`,
      meta: { bucket: storage.bucket, endpointReady: true },
    });
  } catch (err) {
    return fail({
      key: "storage",
      label: "对象存储",
      detail: `对象存储不可用：${(err as Error).message}`,
      remediation: "检查 S3_ENDPOINT/S3_INTERNAL_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY 与桶权限。",
      meta: { bucket: config.storage.bucket, endpointReady: false },
    });
  }
}

export async function checkQueueFreshness(pool: Pool): Promise<CheckResult> {
  try {
    const queue = new JobQueue(pool);
    const age = await queue.lastBeatAgeSeconds();
    const backlog = await queue.backlog();
    if (age === null) {
      return fail({
        key: "queue",
        label: "队列消费",
        detail: "数据库队列表可访问，但从未收到 worker 心跳：长任务执行器未启动",
        remediation: "启动 worker 进程（compose: worker 服务；独立部署: npm run start:worker）。",
        meta: { backlog },
      });
    }
    if (age > 60) {
      return warn({
        key: "queue",
        label: "队列消费",
        detail: `worker 最近心跳距今 ${Math.round(age)}s，可能已停止或重启中；积压 ${backlog.queued}`,
        remediation: "检查 worker 日志 `docker compose logs worker`，确认租约心跳与数据库连接。",
        meta: { lastBeatAgeSeconds: age, backlog },
      });
    }
    return ok({
      key: "queue",
      label: "队列消费",
      detail: `worker 在线（心跳 ${Math.round(age)}s 前），等待 ${backlog.queued} / 执行中 ${backlog.running}`,
      meta: { lastBeatAgeSeconds: age, backlog },
    });
  } catch (err) {
    return fail({
      key: "queue",
      label: "队列消费",
      detail: `队列状态不可读：${(err as Error).message}`,
      meta: {},
    });
  }
}

/**
 * 鉴权主动探针：故意携带无效令牌访问受保护接口，
 * 期望 401。返回 200 说明鉴权被绕过（严重）。
 */
export async function checkAuthProbe(config: AppConfig, baseUrl: string): Promise<CheckResult> {
  try {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: "Bearer probe.invalid.token" },
    });
    if (res.status === 401) {
      return ok({
        key: "auth",
        label: "鉴权",
        detail: "无效令牌被拒绝（401），当前自检结果也已通过真实登录态鉴权",
        meta: { rejectedStatus: 401 },
      });
    }
    return fail({
      key: "auth",
      label: "鉴权",
      detail: `受保护接口对无效令牌返回 ${res.status}，鉴权可能被绕过`,
      remediation: "确认 authGuard 已挂载到所有业务路由，检查反向代理是否改写 Authorization。",
      meta: { rejectedStatus: res.status },
    });
  } catch (err) {
    return fail({
      key: "auth",
      label: "鉴权",
      detail: `鉴权探针请求失败：${(err as Error).message}`,
      meta: {},
    });
  }
}

/**
 * 上传回调真实链路：
 * 1) 申请上传 -> 真实 PUT 字节到对象存储
 * 2) 回调登记（第一次）
 * 3) 同 idempotency-key 再回调一次，必须返回同素材且 duplicate=true（回调重复验收）
 * 全程不返回密钥，预签名地址仅短 TTL。
 */
export async function checkUploadCallback(
  config: AppConfig,
  tenantId: string,
  projectId: string
): Promise<CheckResult> {
  const storage = getStorage();
  const pool = poolRef();
  const assets = new AssetRepo(pool);
  const projects = new ProjectRepo(pool);
  const project = await projects.get(tenantId, projectId);
  if (!project) throw new Error("selfcheck project missing");

  const key = `tenants/${tenantId}/_selfcheck/${Date.now()}.txt`;
  const body = Buffer.from(`selfcheck upload ${Date.now()}`, "utf8");
  await storage.put(key, body, body.length, "text/plain");
  const checksum = createHash("sha256").update(body).digest("hex");
  const idem = `selfcheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseInput = {
    tenantId,
    projectId,
    filename: "selfcheck.txt",
    kind: "text",
    sizeBytes: body.length,
    storageKey: key,
    bucket: storage.bucket,
    checksum,
    payloadHash: checksum,
  };
  const first = await assets.createFromCallback({ ...baseInput, idempotencyKey: idem });
  const second = await assets.createFromCallback({ ...baseInput, idempotencyKey: idem });

  const pass = !first.duplicate && second.duplicate && first.asset.id === second.asset.id;
  return pass
    ? ok({
        key: "uploadCallback",
        label: "上传回调（含重复回调）",
        detail: "真实对象写入 + 回调登记成功；重复回调被幂等去重，未产生第二条素材",
        meta: { assetId: first.asset.id, duplicateSuppressed: true },
      })
    : fail({
        key: "uploadCallback",
        label: "上传回调（含重复回调）",
        detail: "回调幂等行为异常：重复回调产生了新素材或登记结果不一致",
        remediation: "检查 upload_callbacks 唯一索引 (tenant_id, idempotency_key) 与事务逻辑。",
        meta: { firstDuplicate: first.duplicate, secondDuplicate: second.duplicate },
      });
}

let poolProvider: (() => Pool) | null = null;
export function bindPoolProvider(fn: () => Pool): void {
  poolProvider = fn;
}
function poolRef(): Pool {
  if (!poolProvider) throw new Error("pool provider not bound");
  return poolProvider();
}

/**
 * 队列消费真实链路：投递 probe 任务，等待 worker 实际消费完成。
 * 超时则说明执行器链路不通。
 */
export async function checkQueueConsume(
  pool: Pool,
  tenantId: string,
  timeoutMs = 20000
): Promise<CheckResult> {
  const queue = new JobQueue(pool);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = await queue.enqueue({
    tenantId,
    type: "probe",
    payload: { probe: true, nonce },
    maxAttempts: 1,
  });
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const current = await queue.getForTenant(job.id, tenantId);
    if (current?.status === "succeeded") {
      await queue.deleteProbeJobs(tenantId).catch(() => undefined);
      return ok({
        key: "queueConsume",
        label: "队列消费（真实投递）",
        detail: `探针任务已被 worker 消费完成（${Date.now() - start}ms，租约/心跳链路正常）`,
        meta: { jobId: job.id, durationMs: Date.now() - start, worker: current.leasedBy ?? "completed" },
      });
    }
    if (current?.status === "failed" || current?.status === "dead") {
      return fail({
        key: "queueConsume",
        label: "队列消费（真实投递）",
        detail: `探针任务进入 ${current.status}：${current.error ?? "未知错误"}`,
        meta: { jobId: job.id },
      });
    }
    if (Date.now() - start > timeoutMs) {
      return fail({
        key: "queueConsume",
        label: "队列消费（真实投递）",
        detail: `探针任务 ${timeoutMs / 1000}s 内未被消费（当前 ${current?.status ?? "unknown"}）`,
        remediation: "检查 worker 是否运行、迁移是否完整、其 DATABASE_URL 是否与 API 指向同一库。",
        meta: { jobId: job.id, status: current?.status },
      });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
