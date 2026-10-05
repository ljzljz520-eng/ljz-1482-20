import { loadConfig, logConfigErrors } from "./config/env";
import { createLogger } from "./config/logger";
import { initPool } from "./db/pool";
import { applyAllMigrations } from "./db/migrate";
import { initStorage } from "./storage/client";
import { buildApp } from "./server/app";
import { startWorker } from "./worker";

const role = process.argv[2] ?? "api";

async function main() {
  const log = createLogger(`workbench:${role}`);
  const result = loadConfig();

  if (!result.config || result.missing.length > 0 || result.errors.length > 0) {
    logConfigErrors(result, log);
    if (role === "api") {
      // API 仍启动，但只暴露 health/live 与 503 ready，自检页必须看到“不可用原因”而不是假成功
      result.config = result.config ?? null;
    }
    if (role === "worker") {
      log.error("环境变量不完整，worker 拒绝启动（避免空转冒充消费）");
      process.exit(1);
    }
  }

  const config = result.config;

  if (role === "worker") {
    if (!config) process.exit(1);
    initPool(config);
    initStorage(config);
    await startWorker(config, log);
    return;
  }

  if (!config) {
    // 最小可用 API：仅存活/就绪探针，明确展示缺什么
    const app = (await import("fastify")).default({ logger: true });
    app.get("/api/health/live", async () => ({ ok: true, ts: new Date().toISOString() }));
    app.get("/api/*", async (_req, reply) =>
      reply.code(503).send({
        ok: false,
        code: "CONFIG_MISSING",
        reason: `服务未完成配置：缺少 ${result.missing.join(", ")}`,
        errors: result.errors,
      })
    );
    const port = Number(process.env.PORT ?? 8000);
    await app.listen({ host: "0.0.0.0", port });
    return;
  }

  initPool(config);
  const storage = initStorage(config);

  if (config.migrationLevel === "latest" && process.env.AUTO_MIGRATE !== "false") {
    const applied = await applyAllMigrations(initPool(config));
    if (applied.length) log.info({ count: applied.length }, "启动时自动迁移完成");
  }
  await storage.ensureBucket().catch((err) => {
    log.error({ err: err.message }, "存储桶初始化失败，自检会展示该不可用原因");
  });

  const app = await buildApp(result, config);
  await app.listen({ host: "0.0.0.0", port: config.port });
  log.info(
    { port: config.port, env: config.env, version: config.apiVersion, sha: config.buildSha },
    "创作工作台 API 已启动"
  );

  const shutdown = async () => {
    log.info("API 收到退出信号，关闭 HTTP（在途任务由数据库租约保障续接）");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[fatal]", err);
  process.exit(1);
});
