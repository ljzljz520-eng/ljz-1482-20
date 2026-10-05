import { loadConfig } from "../config/env";
import { createLogger } from "../config/logger";
import { initPool, closePool } from "../db/pool";
import { applyAllMigrations } from "../db/migrate";
import { hashPassword } from "../auth";

interface TenantSeed {
  slug: string;
  name: string;
  users: Array<{ username: string; displayName: string; password: string; role: "admin" | "member" }>;
  projectName: string;
}

const SEEDS: TenantSeed[] = [
  {
    slug: "demo",
    name: "演示工作室",
    users: [
      { username: "admin", displayName: "演示管理员", password: "123456", role: "admin" },
    ],
    projectName: "欢迎项目",
  },
  {
    slug: "demo2",
    name: "第二租户（隔离验证用）",
    users: [
      { username: "admin2", displayName: "二号租户管理员", password: "123456", role: "admin" },
    ],
    projectName: "二号租户项目",
  },
];

async function main() {
  const log = createLogger("seed");
  const result = loadConfig();
  if (!result.config || result.missing.length) {
    log.error({ missing: result.missing }, "缺少环境变量，无法 seed");
    process.exit(2);
  }
  const pool = initPool(result.config);
  await applyAllMigrations(pool);

  for (const seed of SEEDS) {
    const tenant = await pool.query(
      `INSERT INTO tenants (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [seed.slug, seed.name]
    );
    const tenantId = tenant.rows[0].id as string;

    for (const u of seed.users) {
      const existing = await pool.query("SELECT id FROM users WHERE username = $1", [u.username]);
      if (existing.rowCount === 0) {
        await pool.query(
          `INSERT INTO users (tenant_id, username, display_name, password_hash, role)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, u.username, u.displayName, await hashPassword(u.password), u.role]
        );
        log.info({ username: u.username, tenant: seed.slug }, "已创建演示用户");
      }
    }

    const projectCount = await pool.query(
      "SELECT count(*)::int AS n FROM projects WHERE tenant_id = $1",
      [tenantId]
    );
    if (projectCount.rows[0].n === 0) {
      const user = await pool.query("SELECT id FROM users WHERE tenant_id = $1 LIMIT 1", [tenantId]);
      await pool.query(
        "INSERT INTO projects (tenant_id, name, description, created_by) VALUES ($1,$2,$3,$4)",
        [tenantId, seed.projectName, "种子数据：用于验证多租户隔离", user.rows[0].id]
      );
      log.info({ tenant: seed.slug }, "已创建演示项目");
    }
  }
  log.info("seed 完成");
  await closePool();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[seed fatal]", err);
  process.exit(1);
});
