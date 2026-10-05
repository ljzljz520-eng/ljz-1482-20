import { loadConfig } from "../config/env";
import { createLogger } from "../config/logger";
import { initPool, closePool } from "../db/pool";
import {
  applyAllMigrations,
  applyNextMigration,
  migrationStatus,
} from "../db/migrate";

const command = process.argv[2] ?? "status";

async function main() {
  const log = createLogger("migrate");
  const result = loadConfig();
  if (!result.config || result.missing.length) {
    log.error({ missing: result.missing }, "缺少环境变量，无法迁移");
    process.exit(2);
  }
  const pool = initPool(result.config);
  const before = await migrationStatus(pool);

  if (command === "status") {
    log.info(
      { applied: before.applied, pending: before.pending.map((p) => p.version) },
      before.complete ? "迁移完整" : "存在未执行迁移"
    );
    process.exit(before.complete ? 0 : 3);
  }
  if (command === "one") {
    const next = await applyNextMigration(pool);
    log.info({ applied: next?.name ?? null }, next ? "已执行单个迁移" : "没有待执行迁移");
  } else if (command === "up") {
    const applied = await applyAllMigrations(pool);
    log.info({ count: applied.length, files: applied.map((f) => f.name) }, "迁移完成");
  } else {
    log.error({ command }, "未知迁移命令，支持: status | up | one");
    process.exit(2);
  }
  await closePool();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate fatal]", err);
  process.exit(1);
});
