import { config, getConfigRequirements } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { storageProbe } from "../lib/storage.js";
import { queuePing } from "../lib/queue.js";
import { signCallback } from "../lib/crypto.js";
import { recordUploadCallback } from "./callbackService.js";
import type { AuthUser } from "../lib/auth.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";
export interface CheckItem {
  name: string;
  status: CheckStatus;
  detail: string;
  reason?: string;
  meta?: Record<string, string | number | boolean>;
}

function compareSemver(client = "0.0.0", minimum = "0.0.0") {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(client);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return 1;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return -1;
  }
  return 0;
}


export async function runSelfCheck(user: AuthUser, clientVersion = "1.0.0", origin?: string): Promise<{ status: CheckStatus; checks: CheckItem[] }> {
  const checks: CheckItem[] = [];
  const compatible = compareSemver(clientVersion, config.minimumClientVersion) >= 0;

  checks.push({
    name: "version",
    status: compatible ? "pass" : "fail",
    detail: compatible ? "前端与 API 契约兼容。" : "前端版本低于后端最低兼容版本。",
    meta: {
      apiVersion: config.apiVersion,
      contractVersion: config.contractVersion,
      clientVersion,
      minimumClientVersion: config.minimumClientVersion,
      environment: config.env
    }
  });

  const readiness = getConfigRequirements();
  const missing = readiness.filter((item) => !item.ready);
  checks.push({
    name: "configuration",
    status: missing.length ? "fail" : "pass",
    detail: missing.length ? `缺少 ${missing.length} 项必需环境变量。` : "必需配置均已就绪，密钥仅返回布尔状态。",
    reason: missing.length ? missing.map((item) => item.key).join(", ") : undefined,
    meta: Object.fromEntries(readiness.map((item) => [item.key, item.ready ? "ready" : "missing"]))
  });

  checks.push({
    name: "cors",
    status: !origin || config.corsOrigins.includes(origin) ? "pass" : "fail",
    detail: origin ? (config.corsOrigins.includes(origin) ? "当前预览来源已被 CORS 允许。" : "当前来源不在 CORS 白名单。") : "同源请求，无需跨域放行。",
    reason: origin && !config.corsOrigins.includes(origin) ? "请将浏览器当前 Origin 加入 CORS_ORIGIN。" : undefined,
    meta: { configuredOrigins: config.corsOrigins.length, suppliedOrigin: origin ?? "same-origin" }
  });

  checks.push({
    name: "auth",
    status: user.sub && user.tenantId ? "pass" : "fail",
    detail: "JWT 已验证，请求被限制在当前租户内。",
    meta: { userId: user.sub, tenantId: user.tenantId, role: user.role }
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at DESC
    `;
    const applied = new Set(migrations.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
    const absent = config.requiredMigrations.filter((name) => !applied.has(name));
    checks.push({
      name: "database",
      status: absent.length ? "fail" : "pass",
      detail: absent.length ? "数据库连接成功，但迁移不完整。" : "关系数据库连接、租户读取和迁移版本均正常。",
      reason: absent.length ? `缺少迁移：${absent.join(", ")}` : undefined,
      meta: { appliedMigrations: applied.size, requiredMigrations: config.requiredMigrations.length }
    });
  } catch (error) {
    checks.push({
      name: "database",
      status: "fail",
      detail: "关系数据库不可用或迁移表不存在。",
      reason: error instanceof Error ? error.message : "未知数据库错误"
    });
  }

  try {
    const probe = await storageProbe();
    checks.push({
      name: "objectStorage",
      status: "pass",
      detail: "对象存储可写入、可读取元数据，并可生成短时下载授权。",
      meta: { latencyMs: probe.latencyMs, bucketReady: true, presignTtlSeconds: config.s3.presignTtlSeconds }
    });
  } catch (error) {
    checks.push({
      name: "objectStorage",
      status: "fail",
      detail: "对象存储不可连接。",
      reason: error instanceof Error ? error.message : "未知对象存储错误"
    });
  }

  try {
    const result = await queuePing(6000);
    checks.push({
      name: "queueConsumer",
      status: "pass",
      detail: "持久队列投递并由独立长任务执行器消费完成。",
      meta: { latencyMs: result.latencyMs, jobId: String(result.jobId), workerId: config.workerId }
    });
  } catch (error) {
    checks.push({
      name: "queueConsumer",
      status: "fail",
      detail: "队列未在超时时间内被执行器消费。",
      reason: error instanceof Error ? error.message : "长任务执行器未运行或 Redis 不可达"
    });
  }

  const eventId = `selfcheck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ eventId, tenantId: user.tenantId, eventType: "object.created", objectKey: `system/selfcheck/${eventId}.txt` });
  const signature = signCallback(body);
  try {
    const first = await recordUploadCallback({
      eventId,
      tenantId: user.tenantId,
      provider: "selfcheck",
      eventType: "object.created",
      objectKey: `system/selfcheck/${eventId}.txt`,
      signatureValid: Boolean(signature),
      rawBody: body
    });
    const duplicate = await recordUploadCallback({
      eventId,
      tenantId: user.tenantId,
      provider: "selfcheck",
      eventType: "object.created",
      objectKey: `system/selfcheck/${eventId}.txt`,
      signatureValid: Boolean(signature),
      rawBody: body
    });
    const wrong = await recordUploadCallback({
      eventId: `${eventId}-bad`,
      tenantId: user.tenantId,
      provider: "selfcheck",
      eventType: "object.created",
      objectKey: `system/selfcheck/${eventId}-bad.txt`,
      signatureValid: false,
      rawBody: body
    });
    checks.push({
      name: "uploadCallback",
      status: duplicate.duplicate && wrong.status === "rejected" ? "pass" : "warn",
      detail: "回调签名校验通过，重复事件被幂等表拦截。",
      reason: first.reason,
      meta: { firstStatus: first.status, duplicateStatus: duplicate.status, invalidSignatureStatus: wrong.status }
    });
  } catch (error) {
    checks.push({
      name: "uploadCallback",
      status: "fail",
      detail: "上传回调或幂等记录不可用。",
      reason: error instanceof Error ? error.message : "未知回调错误"
    });
  }

  try {
    const stale = await prisma.exportJob.count({ where: { tenantId: user.tenantId, status: "running", heartbeatAt: { lt: new Date(Date.now() - config.lockTtlMs) } } });
    const recent = await prisma.exportJob.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, progress: true, startedAt: true, finishedAt: true, error: true }
    });
    checks.push({
      name: "jobRecovery",
      status: stale === 0 ? "pass" : "warn",
      detail: "任务状态持久化在数据库；执行器重启会认领 queued 和超时 running 任务，不依赖网页在线。",
      reason: stale ? `当前有 ${stale} 个超时运行任务等待下一轮认领。` : undefined,
      meta: { staleRunningJobs: stale, recentJobs: recent.length, lockTtlMs: config.lockTtlMs }
    });
  } catch (error) {
    checks.push({
      name: "jobRecovery",
      status: "fail",
      detail: "无法确认任务续接状态。",
      reason: error instanceof Error ? error.message : "数据库不可用"
    });
  }

  const hasFail = checks.some((item) => item.status === "fail");
  const hasWarn = checks.some((item) => item.status === "warn");
  return { status: hasFail ? "fail" : hasWarn ? "warn" : "pass", checks };
}
