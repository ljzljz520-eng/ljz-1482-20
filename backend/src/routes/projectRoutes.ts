import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const createProjectSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional()
});

const idSchema = z.object({ id: z.string().min(1) });

export default async function projectRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/projects", async (request) => {
    const projects = await prisma.project.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { assets: true, exports: true } } }
    });
    return { items: projects };
  });

  app.post("/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "项目名称需为 2-80 个字符。", details: parsed.error.flatten() });
    }
    const project = await prisma.project.create({
      data: {
        tenantId: request.user.tenantId,
        createdById: request.user.sub,
        name: parsed.data.name,
        description: parsed.data.description
      }
    });
    return reply.code(201).send(project);
  });

  app.get("/projects/:id", async (request, reply) => {
    const params = idSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "NOT_FOUND", message: "项目不存在。" });
    const project = await prisma.project.findFirst({
      where: { id: params.data.id, tenantId: request.user.tenantId },
      include: {
        assets: { orderBy: { createdAt: "desc" } },
        exports: { orderBy: { createdAt: "desc" }, take: 10 }
      }
    });
    if (!project) return reply.code(404).send({ error: "NOT_FOUND", message: "项目不存在或属于其他租户。" });
    return project;
  });
}
