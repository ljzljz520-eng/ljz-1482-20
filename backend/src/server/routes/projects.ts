import { FastifyInstance } from "fastify";
import { AppConfig } from "../../config/env";
import { getPool } from "../../db/pool";
import { ProjectRepo } from "../../db/repos";
import { migrationStatus } from "../../db/migrate";
import { authGuard, requireAuth, tenantScope } from "../../auth";

export function registerProjectRoutes(app: FastifyInstance, config: AppConfig) {
  const guard = authGuard(config);

  app.get("/api/projects", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const pool = getPool();
    const status = await migrationStatus(pool).catch(() => null);
    if (!status || !status.complete) {
      return reply.code(503).send({
        ok: false,
        code: "MIGRATION_INCOMPLETE",
        reason: "数据库迁移不完整，项目接口已禁用，请先执行迁移。",
      });
    }
    return { ok: true, items: await new ProjectRepo(pool).list(tenantId) };
  });

  app.post("/api/projects", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const body = (req.body ?? {}) as { name?: string; description?: string };
    const name = (body.name ?? "").trim();
    const description = (body.description ?? "").trim();
    if (!name || name.length > 80) {
      return reply.code(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        reason: "项目名称必填且不超过 80 字。",
      });
    }
    if (description.length > 500) {
      return reply.code(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        reason: "项目描述不超过 500 字。",
      });
    }
    const pool = getPool();
    const project = await new ProjectRepo(pool).create(
      tenantId,
      name,
      description,
      requireAuth(req).user.id
    );
    req.log.info({ tenantId, projectId: project.id }, "项目创建");
    return reply.code(201).send({ ok: true, item: project });
  });
}
