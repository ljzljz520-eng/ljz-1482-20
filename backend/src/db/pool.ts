import { Pool } from "pg";
import { AppConfig } from "../config/env";

let pool: Pool | null = null;

export function initPool(config: AppConfig): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => {
    // 空闲连接错误不能让进程崩溃
    // eslint-disable-next-line no-console
    console.error("[pg] idle client error", err.message);
  });
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error("DB pool not initialized");
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
