import { FastifyInstance } from "fastify";
import { AppConfig, ConfigResult, publicRuntimeInfo } from "../../config/env";
import { getPool } from "../../db/pool";
import { ProjectRepo } from "../../db/repos";
import { authGuard, tenantScope } from "../../auth";
import {
  CheckResult,
  bindPoolProvider,
  checkAuthProbe,
  checkConfigReadiness,
  checkDatabase,
  checkQueueConsume,
  checkQueueFreshness,
  checkStorage,
  checkUploadCallback,
  checkVersion,
} from "../../selfcheck/checks";

/**
 * 部署自检：
 * - 结果仅限当前租户可见，不返回任何其他租户数据/任务/存储信息
 * - 密钥只给 ready/missing 布尔，响应体内不含任何密钥值
 * - 所有探测真实执行，失败必须给出不可用原因，不存在“假装成功”分支
 */
export function registerSelfcheckRoutes(
  app: FastifyInstance,
  config: AppConfig,
  configResult: ConfigResult
) {
  bindPoolProvider(getPool);
  const guard = authGuard(config);

  app.get("/api/selfcheck", { preHandler: guard }, async (req) => {
    const tenantId = tenantScope(req);
    const clientVersion = req.headers["x-client-version"] as string | undefined;
    const pool = getPool();

    const checks: CheckResult[] = [];
    checks.push(checkVersion(config, clientVersion));
    checks.push(checkConfigReadiness(configResult.config, configResult.missing, configResult.errors));

    let dbCheck = await checkDatabase(pool).catch((err: Error) => ({
      key: "database",
      label: "关系数据库 & 迁移",
      status: "fail" as const,
      detail: `探测异常：${err.message}`,
    }));
    checks.push(dbCheck);

    let migrationsComplete = dbCheck.status === "pass";

    if (migrationsComplete) {
      checks.push(
        await checkStorage(config).catch((err: Error) => ({
          key: "storage",
          label: "对象存储",
          status: "fail" as const,
          detail: `探测异常：${err.message}`,
        }))
      );
      checks.push(await checkQueueFreshness(pool));
      checks.push(
        await checkAuthProbe(config, config.publicBaseUrl || `http://127.0.0.1:${config.port}`).catch(
          (err: Error) => ({
            key: "auth",
            label: "鉴权",
            status: "fail" as const,
            detail: `探测异常：${err.message}`,
          })
        )
      );
    } else {
      checks.push({
        key: "storage",
        label: "对象存储",
        status: "warn",
        detail: "因数据库迁移不完整，已跳过存储深度探测（配置就绪性见上）。",
      });
      checks.push({
        key: "queue",
        label: "队列消费",
        status: "warn",
        detail: "因数据库迁移不完整，已跳过队列探测。",
      });
    }

    return {
      ok: true,
      runtime: publicRuntimeInfo(config),
      isolated: true,
      scope: { tenantId },
      checks,
      summary: summarize(checks),
    };
  });

  /**
   * 深度贯通探针：真实建项目 → 上传 → 回调重复 → 入队 → worker 消费。
   * 仅对当前租户操作，探针数据带 _selfcheck 前缀。
   */
  app.post("/api/selfcheck/run-probes", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const clientVersion = req.headers["x-client-version"] as string | undefined;
    const pool = getPool();
    const results: CheckResult[] = [];

    const projects = new ProjectRepo(pool);
    let project = (await projects.list(tenantId)).find((p) => p.name.startsWith("[自检]")) ?? null;
    if (!project) {
      project = await projects.create(tenantId, "[自检] 贯通探针", "部署自检自动创建", req.auth!.user.id);
    }
    results.push({
      key: "projectCreate",
      label: "真实项目创建",
      status: "pass",
      detail: `已在当前租户下创建/复用自检项目 ${project.id}`,
      meta: { projectId: project.id },
    });

    results.push(
      await checkUploadCallback(config, tenantId, project.id).catch((err: Error) => ({
        key: "uploadCallback",
        label: "上传回调（含重复回调）",
        status: "fail" as const,
        detail: `探测异常：${err.message}`,
      }))
    );

    results.push(
      await checkQueueConsume(pool, tenantId, 20000).catch((err: Error) => ({
        key: "queueConsume",
        label: "队列消费（真实投递）",
        status: "fail" as const,
        detail: `探测异常：${err.message}`,
      }))
    );

    return reply.send({
      ok: true,
      runtime: publicRuntimeInfo(config),
      scope: { tenantId },
      clientVersion: clientVersion ?? null,
      checks: results,
      summary: summarize(results),
    });
  });
}

function summarize(checks: CheckResult[]): { pass: number; fail: number; warn: number; healthy: boolean } {
  const summary = { pass: 0, fail: 0, warn: 0, healthy: false };
  for (const c of checks) summary[c.status] += 1;
  summary.healthy = summary.fail === 0;
  return summary;
}
