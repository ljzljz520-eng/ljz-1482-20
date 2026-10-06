import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createDownloadUrl } from "../lib/storage.js";
import { enqueueExport } from "../lib/queue.js";

const createExportSchema = z.object({
  projectId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(120)
});

export default async function exportRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.post("/exports", async (request, reply) => {
    const parsed = createExportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "导出参数不完整。", details: parsed.error.flatten() });
    }
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, tenantId: request.user.tenantId },
      include: { assets: { where: { status: "ready" } } }
    });
    if (!project) return reply.code(404).send({ error: "PROJECT_NOT_FOUND", message: "项目不存在或属于其他租户。" });
    if (project.assets.length === 0) {
      return reply.code(409).send({ error: "NO_READY_ASSETS", message: "请先上传并确认至少一个素材。" });
    }

    let job;
    let existing = false;
    try {
      job = await prisma.exportJob.create({
        data: {
          tenantId: request.user.tenantId,
          projectId: project.id,
          idempotencyKey: parsed.data.idempotencyKey,
          status: "queued",
          progress: 0
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        job = await prisma.exportJob.findUniqueOrThrow({ where: { idempotencyKey: parsed.data.idempotencyKey } });
        if (job.tenantId !== request.user.tenantId) return reply.code(404).send({ error: "NOT_FOUND", message: "导出任务不存在。" });
        existing = true;
      } else {
        throw error;
      }
    }

    if (!existing) {
      await enqueueExport(job.id, { exportId: job.id, projectId: project.id, tenantId: request.user.tenantId });
    }

    return reply.code(existing ? 200 : 202).send({
      job,
      execution: {
        mode: "persistent-queue",
        requestScope: false,
        restartSafe: true,
        pollUrl: `/api/exports/${job.id}`
      }
    });
  });

  app.get("/exports/:id", async (request, reply) => {
    const id = String((request.params as { id?: string }).id ?? "");
    const job = await prisma.exportJob.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { project: { select: { id: true, name: true } } }
    });
    if (!job) return reply.code(404).send({ error: "NOT_FOUND", message: "导出任务不存在或属于其他租户。" });
    let downloadUrl: string | undefined;
    let downloadExpiresAt: string | undefined;
    if (job.status === "succeeded" && job.outputKey) {
      downloadUrl = await createDownloadUrl(job.outputKey, `attachment; filename="export-${job.id}.zip"`);
      downloadExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }
    return { ...job, downloadUrl, downloadExpiresAt, recovery: {
      durableStateIn: "PostgreSQL",
      payloadQueueIn: "Redis BullMQ",
      restartClaim: "worker 启动和定时扫描会重新认领 queued 以及心跳超时 running 任务"
    } };
  });

  app.get("/projects/:projectId/exports", async (request, reply) => {
    const projectId = String((request.params as { projectId?: string }).projectId ?? "");
    const project = await prisma.project.findFirst({ where: { id: projectId, tenantId: request.user.tenantId } });
    if (!project) return reply.code(404).send({ error: "NOT_FOUND", message: "项目不存在。" });
    const items = await prisma.exportJob.findMany({ where: { projectId, tenantId: request.user.tenantId }, orderBy: { createdAt: "desc" } });
    return { items };
  });
}
