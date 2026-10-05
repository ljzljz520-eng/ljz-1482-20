import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || join(__dirname, "migrations");

// 迁移互斥锁：API 启动自动迁移与 seed/手动迁移可能并发，必须串行化 DDL
const MIGRATION_LOCK_KEY = 91001;

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

export function listMigrationFiles(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();
  return files.map((f) => {
    const version = f.split("_")[0];
    return { version, name: f, path: join(MIGRATIONS_DIR, f) };
  });
}

async function tableExists(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT to_regclass('schema_migrations') IS NOT NULL AS exists"
  );
  return Boolean(rows[0].exists);
}

export async function appliedVersions(pool: Pool): Promise<string[]> {
  if (!(await tableExists(pool))) return [];
  const { rows } = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  return rows.map((r) => String(r.version));
}

export interface MigrationStatus {
  applied: string[];
  pending: MigrationFile[];
  complete: boolean;
  latestVersion: string | null;
}

/** 表尚未创建视为全部 pending；该函数绝不执行 DDL，避免与迁移进程抢系统目录 */
export async function migrationStatus(pool: Pool): Promise<MigrationStatus> {
  const files = listMigrationFiles();
  const applied = await appliedVersions(pool);
  const appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f.version));
  return {
    applied,
    pending,
    complete: (await tableExists(pool)) && pending.length === 0,
    latestVersion: applied.at(-1) ?? null,
  };
}

export async function applyNextMigration(pool: Pool): Promise<MigrationFile | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 事务级咨询锁：多实例同时启动时只有一个执行 DDL，其余排队后跳过
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const appliedSet = new Set(rows.map((r) => String(r.version)));
    const next = listMigrationFiles().find((f) => !appliedSet.has(f.version));
    if (!next) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(readFileSync(next.path, "utf8"));
    await client.query(
      "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
      [next.version, next.name]
    );
    await client.query("COMMIT");
    return next;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function applyAllMigrations(pool: Pool): Promise<MigrationFile[]> {
  const appliedNow: MigrationFile[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = await applyNextMigration(pool);
    if (!next) break;
    appliedNow.push(next);
  }
  return appliedNow;
}
