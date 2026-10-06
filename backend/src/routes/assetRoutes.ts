import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { createUploadUrl } from "../lib/storage.js";
import { signUploadToken } from "../lib/crypto.js";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

const requestSchema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1).max(180),
  contentType: z.enum(["audio/wav", "audio/x-wav", "image/png", "image/jpeg", "video/mp4", "text/plain"]),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024)
});

const projectIdSchema = z.object({ projectId: z.string().min(1) });

export default async function assetRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.post("/assets/upload-url", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "素材信息不符合要求。", details: parsed.error.flatten() });
    }
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, tenantId: request.user.tenantId }
    });
    if (!project) return reply.code(404).send({ error: "PROJECT_NOT_FOUND", message: "不能向不存在或其他租户的项目上传。" });

    const safeName = parsed.data.filename.replace(/[^\w.\-一-龥]+/g, "_");
    const objectKey = `tenants/${request.user.tenantId}/projects/${project.id}/${Date.now()}-${nanoid()}-${safeName}`;
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const asset = await prisma.asset.create({
      data: {
        tenantId: request.user.tenantId,
        projectId: project.id,
        objectKey,
        filename: safeName,
        mimeType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        status: "waiting_callback"
      }
    });
    const uploadUrl = await createUploadUrl(objectKey, parsed.data.contentType);
    return reply.code(201).send({
      asset,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": parsed.data.contentType },
      callbackConfirmation: {
        url: "/api/callbacks/uploads/presigned",
        expiresAt,
        objectKey,
        tenantId: request.user.tenantId,
        token: signUploadToken(objectKey, request.user.tenantId, expiresAt)
      }
    });
  });

  app.get("/projects/:projectId/assets", async (request, reply) => {
    const params = projectIdSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "NOT_FOUND", message: "项目不存在。" });
    const project = await prisma.project.findFirst({ where: { id: params.data.projectId, tenantId: request.user.tenantId } });
    if (!project) return reply.code(404).send({ error: "NOT_FOUND", message: "项目不存在或属于其他租户。" });
    const assets = await prisma.asset.findMany({
      where: { projectId: project.id, tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" }
    });
    return { items: assets };
  });
}
