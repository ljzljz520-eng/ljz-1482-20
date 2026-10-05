import { FastifyInstance } from "fastify";
import { AppConfig, ConfigResult } from "../../config/env";
import { getPool } from "../../db/pool";
import { migrationStatus } from "../../db/migrate";
import { isCompatible } from "../../selfcheck/version";

/** 不依赖数据库/鉴权：容器存活探针 */
export function registerHealthRoutes(app: FastifyInstance, configResult: ConfigResult) {
  app.get("/api/health/live", async () => ({ ok: true, ts: new Date().toISOString() }));

  /** 就绪探针：环境变量、数据库、迁移完整度；编排系统据此决定是否导流 */
  app.get("/api/health/ready", async (_req, reply) => {
    const problems: string[] = [];
    if (configResult.missing.length) problems.push(`缺少环境变量: ${configResult.missing.join(",")}`);
    if (configResult.errors.length) problems.push(...configResult.errors);
    let db: unknown = null;
    if (configResult.config) {
      try {
        const pool = getPool();
        const status = await migrationStatus(pool);
        db = {
          connected: true,
          migrationsComplete: status.complete,
          pending: status.pending.map((p) => p.version),
        };
        if (!status.complete) problems.push("数据库迁移不完整");
      } catch (err) {
        db = { connected: false, reason: (err as Error).message };
        problems.push("数据库不可用");
      }
    }
    const ready = problems.length === 0;
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      env: configResult.config?.env ?? "unknown",
      problems,
      db,
    });
  });

  /** 版本协商：前端启动时调用，决定是否禁用功能并提示升级 */
  app.get("/api/version", async (req) => {
    const cfg: AppConfig = configResult.config!;
    const clientVersion = (req.headers["x-client-version"] as string | undefined) ?? undefined;
    return {
      ok: true,
      env: cfg.env,
      apiVersion: cfg.apiVersion,
      minClientVersion: cfg.minClientVersion,
      buildSha: cfg.buildSha,
      clientVersion: clientVersion ?? null,
      compatible: isCompatible(clientVersion, cfg.minClientVersion),
    };
  });
}
