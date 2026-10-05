import { Pool } from "pg";
import { JobPayload, JobRecord, JobType } from "./types";

interface EnqueueInput {
  tenantId: string;
  type: JobType;
  payload: JobPayload;
  maxAttempts?: number;
  runAt?: Date;
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    type: row.type as JobType,
    status: row.status as JobRecord["status"],
    payload: row.payload as JobPayload,
    result: (row.result as Record<string, unknown>) ?? null,
    error: (row.error as string) ?? null,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    leasedBy: (row.leased_by as string) ?? null,
    heartbeatAt: (row.heartbeat_at as Date) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    finishedAt: (row.finished_at as Date) ?? null,
  };
}

export class JobQueue {
  constructor(private pool: Pool) {}

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO jobs (tenant_id, type, payload, max_attempts, run_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()))
       RETURNING *`,
      [
        input.tenantId,
        input.type,
        JSON.stringify(input.payload),
        input.maxAttempts ?? 3,
        input.runAt ?? null,
      ]
    );
    return mapJob(rows[0]);
  }

  /**
   * 原子认领：FOR UPDATE SKIP LOCKED 保证多 worker 不重复消费。
   * 同时接管租约过期的 running 任务（部署换版/进程崩溃后的在途任务续接）。
   */
  async claim(worker: string, leaseMs: number): Promise<JobRecord | null> {
    const { rows } = await this.pool.query(
      `WITH picked AS (
         SELECT id FROM jobs
         WHERE (status = 'queued' AND run_at <= now())
            OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < now())
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE jobs j SET
         status = 'running',
         leased_by = $1,
         leased_until = now() + ($2 || ' milliseconds')::interval,
         heartbeat_at = now(),
         attempts = j.attempts + 1,
         updated_at = now()
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.*`,
      [worker, leaseMs]
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async heartbeat(id: string, worker: string, leaseMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE jobs
       SET heartbeat_at = now(),
           leased_until = now() + ($3 || ' milliseconds')::interval,
           updated_at = now()
       WHERE id = $1 AND leased_by = $2 AND status = 'running'`,
      [id, worker, leaseMs]
    );
  }

  async succeed(id: string, result: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE jobs
       SET status = 'succeeded', result = $2, error = NULL,
           leased_by = NULL, leased_until = NULL,
           updated_at = now(), finished_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(result)]
    );
  }

  /**
   * 失败处理：仍有重试次数则重新排队（run_at 指数退避），
   * 否则标记 dead，任务永不静默丢失。
   */
  async fail(id: string, error: string): Promise<"retry" | "dead"> {
    const { rows } = await this.pool.query(
      `UPDATE jobs
       SET error = $2,
           leased_by = NULL,
           leased_until = NULL,
           updated_at = now(),
           status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'dead' END,
           run_at = CASE WHEN attempts < max_attempts
                    THEN now() + (POW(2, attempts) * 2 || ' seconds')::interval
                    ELSE run_at END,
           finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE finished_at END
       WHERE id = $1
       RETURNING status`,
      [id, error.slice(0, 2000)]
    );
    return rows[0]?.status === "dead" ? "dead" : "retry";
  }

  async getForTenant(id: string, tenantId: string): Promise<JobRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async recordBeat(worker: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO worker_beats (worker_name) VALUES ($1)",
      [worker]
    );
    await this.pool.query(
      "DELETE FROM worker_beats WHERE beat_at < now() - interval '2 hours'"
    );
  }

  /** 最近一次 worker 心跳年龄（秒）；null = 从未消费 */
  async lastBeatAgeSeconds(): Promise<number | null> {
    const { rows } = await this.pool.query(
      "SELECT EXTRACT(EPOCH FROM (now() - MAX(beat_at)))::float AS age FROM worker_beats"
    );
    return rows[0]?.age == null ? null : Number(rows[0].age);
  }

  /** 队列积压：等待中任务数 + 最老任务年龄（秒） */
  async backlog(): Promise<{ queued: number; oldestAgeSeconds: number | null; running: number }> {
    const { rows } = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'queued') AS queued,
         count(*) FILTER (WHERE status = 'running') AS running,
         EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status IN ('queued','running'))))::float AS oldest_age
       FROM jobs`
    );
    return {
      queued: Number(rows[0].queued),
      running: Number(rows[0].running),
      oldestAgeSeconds: rows[0].oldest_age == null ? null : Number(rows[0].oldest_age),
    };
  }

  /** 清理自检探针任务，避免污染业务队列视图 */
  async deleteProbeJobs(tenantId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM jobs WHERE tenant_id = $1 AND type = 'probe' AND created_at < now() - interval '10 minutes'`,
      [tenantId]
    );
  }
}
