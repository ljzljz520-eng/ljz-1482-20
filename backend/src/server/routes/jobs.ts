import { FastifyInstance } from "fastify";
import { AppConfig } from "../../config/env";
import { getPool } from "../../db/pool";
import { AssetRepo, ProjectRepo } from "../../db/repos";
import { JobQueue } from "../../queue/jobs";
import { getStorage } from "../../storage/client";
import { authGuard, tenantScope } from "../../auth";

export function registerJobRoutes(app: FastifyInstance, config: AppConfig) {
  const guard = authGuard(config);

  /**
   * 创建转码导出：HTTP 只负责持久化入队并立即返回，
   * 真正执行在 worker，请求结束/页面关闭/API 重启都不影响任务。
   */
  app.post("/api/projects/:projectId/exports", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as { simulateDelayMs?: number };
    const simulateDelayMs = Math.min(Number(body.simulateDelayMs ?? 0), 120_000);
    const pool = getPool();
    const project = await new ProjectRepo(pool).get(tenantId, projectId);
    if (!project) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", reason: "项目不存在或无权访问。" });
    }
    const assets = await new AssetRepo(pool).listForProject(tenantId, projectId);
    if (assets.length === 0) {
      return reply.code(409).send({
        ok: false,
        code: "NO_ASSETS",
        reason: "项目还没有素材，至少上传一个小素材后才能导出。",
      });
    }
    const storage = getStorage();
    const exportName = `${project.name.replace(/[^\w一-龥-]+/g, "_")}-${Date.now()}.zip`;
    const exportKey = `tenants/${tenantId}/exports/${projectId}/${exportName}`;
    const queue = new JobQueue(pool);
    const job = await queue.enqueue({
      tenantId,
      type: "export",
      payload: { projectId, exportKey, exportName, simulateDelayMs },
      maxAttempts: config.queue.maxAttempts,
    });
    req.log.info({ tenantId, projectId, jobId: job.id }, "导出任务已入持久队列");
    return reply.code(202).send({
      ok: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        exportName,
        pollUrl: `/api/jobs/${job.id}`,
      },
    });
  });

  app.get("/api/jobs/:id", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const { id } = req.params as { id: string };
    const job = await new JobQueue(getPool()).getForTenant(id, tenantId);
    if (!job) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", reason: "任务不存在或不属于当前租户。" });
    }
    return {
      ok: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        result: job.result,
        heartbeatAt: job.heartbeatAt,
        leasedBy: job.leasedBy,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      },
    };
  });

  /**
   * 下载授权：不直接代理文件流，而是签发短 TTL 预签名 URL。
   * 校验任务归属租户；预览/正式桶与回调域名隔离，链接不可跨环境复用。
   */
  app.post("/api/jobs/:id/download", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const { id } = req.params as { id: string };
    const job = await new JobQueue(getPool()).getForTenant(id, tenantId);
    if (!job) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", reason: "任务不存在或不属于当前租户。" });
    }
    if (job.status !== "succeeded" || !job.result?.exportKey) {
      return reply.code(409).send({
        ok: false,
        code: "JOB_NOT_READY",
        reason: `任务尚未成功（当前 ${job.status}），无法签发下载链接。`,
      });
    }
    const storage = getStorage();
    const exportKey = String(job.result.exportKey);
    const exists = await storage.exists(exportKey);
    if (!exists) {
      return reply.code(410).send({
        ok: false,
        code: "OBJECT_MISSING",
        reason: "导出对象在存储中已不存在（可能被生命周期策略清理），请重新导出。",
      });
    }
    const url = await storage.presignGet(exportKey);
    req.log.info({ tenantId, jobId: job.id }, "签发限时下载链接");
    return {
      ok: true,
      downloadUrl: url,
      expiresInSeconds: config.storage.presignTtlSeconds,
      environment: config.env,
    };
  });
}
