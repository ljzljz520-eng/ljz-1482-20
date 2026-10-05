// 进程内 Postgres（PGlite）迁移与关键约束自检：
// - 迁移可顺序执行且幂等
// - 上传回调唯一索引可拦截重复回调
// - 持久队列表的认领/接管/重试 SQL 语义正确（含 SKIP LOCKED）
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "../dist/db/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
assert.deepStrictEqual(files, ["001_init.sql", "002_project_export_settings.sql"]);

const db = new PGlite();

async function migrateAll() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  for (const f of files) {
    const exists = await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [f.split("_")[0]]);
    if (exists.rows.length) continue;
    await db.exec(readFileSync(join(dir, f), "utf8"));
    await db.query("INSERT INTO schema_migrations (version,name) VALUES ($1,$2)", [f.split("_")[0], f]);
  }
}
await migrateAll();
await migrateAll(); // 幂等

await db.query(`INSERT INTO tenants (id, slug, name) VALUES
 ('11111111-1111-1111-1111-111111111111','t1','T1'),
 ('22222222-2222-2222-2222-222222222222','t2','T2')`);
await db.query(`INSERT INTO projects (id, tenant_id, name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','P1')`);
await db.query(`INSERT INTO assets (id, tenant_id, project_id, filename, storage_key, storage_bucket)
 VALUES ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
 'aaaaaaaa-0000-0000-0000-000000000001','a.txt','k1','workbench-preview')`);

// 重复回调必须在数据库层失败
await db.query(
  `INSERT INTO upload_callbacks (tenant_id, idempotency_key, asset_id, payload_hash)
   VALUES ('11111111-1111-1111-1111-111111111111','idem-1',
   'bbbbbbbb-0000-0000-0000-000000000001','h')`
);
let blocked = false;
try {
  await db.query(
    `INSERT INTO upload_callbacks (tenant_id, idempotency_key, asset_id, payload_hash)
     VALUES ('11111111-1111-1111-1111-111111111111','idem-1',
     'bbbbbbbb-0000-0000-0000-000000000001','h')`
  );
} catch (e) {
  blocked = /duplicate key|unique constraint/i.test(e.message);
}
assert.ok(blocked, "重复 idempotency_key 必须被唯一索引拒绝");

// 不同租户可以使用相同 key（唯一性范围是 (tenant_id,key)）
await db.query(
  `INSERT INTO upload_callbacks (tenant_id, idempotency_key, asset_id, payload_hash)
   SELECT '22222222-2222-2222-2222-222222222222','idem-1',
   'bbbbbbbb-0000-0000-0000-000000000001','h'`
);

// 队列入队 + 认领
await db.query(
  `INSERT INTO jobs (id, tenant_id, type, payload)
   VALUES ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','probe','{"probe":true}'::jsonb)`
);
const claimSql = `
  WITH picked AS (
    SELECT id FROM jobs
    WHERE (status = 'queued' AND run_at <= now())
       OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < now())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE jobs j SET status='running', leased_by=$1,
    leased_until = now() + ($2 || ' milliseconds')::interval,
    heartbeat_at = now(), attempts = j.attempts + 1, updated_at = now()
  FROM picked WHERE j.id = picked.id RETURNING j.*`;
const c1 = await db.query(claimSql, ["worker-A", "30000"]);
assert.equal(c1.rows[0].leased_by, "worker-A");
assert.equal(c1.rows[0].attempts, 1);

// 租约未到期：没有任务可认领
const c2 = await db.query(claimSql, ["worker-B", "30000"]);
assert.equal(c2.rows.length, 0, "租约内的任务不能被其他 worker 抢走");

// 租约过期：新 worker 接管在途任务（进程重启/换版续接）
await db.query("UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id=$1", [
  "cccccccc-0000-0000-0000-000000000001",
]);
const c3 = await db.query(claimSql, ["worker-B", "30000"]);
assert.equal(c3.rows.length, 1);
assert.equal(c3.rows[0].leased_by, "worker-B", "租约过期的在途任务必须能被新 worker 接管");
assert.equal(c3.rows[0].attempts, 2);

// 失败后重试 / dead 状态机
await db.query(
  `UPDATE jobs SET error='boom', leased_by=NULL, leased_until=NULL,
     status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'dead' END,
     run_at = now() + interval '2 seconds'
   WHERE id=$1`,
  ["cccccccc-0000-0000-0000-000000000001"]
);
const st = await db.query("SELECT status FROM jobs WHERE id=$1", [
  "cccccccc-0000-0000-0000-000000000001",
]);
assert.equal(st.rows[0].status, "queued");

// 002 迁移列存在
const cols = await db.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name IN ('export_format','settings')`
);
assert.equal(cols.rows.length, 2);

console.log("db migration & queue self-test: PASS");
