import { Logger } from "pino";
import { AppConfig } from "../config/env";
import { getPool } from "../db/pool";
import { migrationStatus } from "../db/migrate";
import { getStorage } from "../storage/client";
import { JobQueue } from "../queue/jobs";
import { JobRecord } from "../queue/types";
import { runExport } from "../jobs/export";
import { startHealthServer } from "./health";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startWorker(config: AppConfig, log: Logger): Promise<void> {
  const pool = getPool();
  const queue = new JobQueue(pool);
  const storage = getStorage();

  const healthPort = Number(process.env.WORKER_HEALTH_PORT || 9101);
  startHealthServer(healthPort);
  log.info({ worker: config.workerName, healthPort }, "长任务执行器启动");

  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (!shuttingDown) {
    let status;
    try {
      status = await migrationStatus(pool);
    } catch (err) {
      log.error({ err: (err as Error).message }, "迁移状态查询失败，等待数据库恢复");
      await sleep(3000);
      continue;
    }
    if (!status.complete) {
      log.warn({ pending: status.pending.length }, "存在未执行迁移，worker 暂停消费");
      await sleep(3000);
      continue;
    }

    // 迁移完整后立即写一次心跳，使自检不必等到首个任务消费即能确认 worker 在线
    await queue.recordBeat(config.workerName).catch((err) => {
      log.warn({ err: err.message }, "就绪心跳写入失败");
    });

    let job: JobRecord | null = null;
    try {
      job = await queue.claim(config.workerName, config.queue.leaseMs);
    } catch (err) {
      log.error({ err: (err as Error).message }, "认领任务失败");
      await sleep(config.queue.pollIntervalMs);
      continue;
    }

    if (!job) {
      await queue.recordBeat(config.workerName).catch((err) => {
        log.warn({ err: err.message }, "worker 心跳写入失败");
      });
      await sleep(config.queue.pollIntervalMs);
      continue;
    }

    log.info(
      { jobId: job.id, type: job.type, attempt: job.attempts, recovered: job.attempts > 1 },
      "开始消费任务"
    );

    const hb = setInterval(() => {
      queue.heartbeat(job!.id, config.workerName, config.queue.leaseMs).catch(() => undefined);
    }, config.queue.heartbeatMs);

    try {
      const result =
        job.type === "export"
          ? await runExport(job, job.payload as never)
          : { probe: true, nonce: (job.payload as { nonce: string }).nonce };
      // 探针任务也要确认存储可读（probe 无业务文件，仅列桶）
      if (job.type === "probe") {
        await storage.exists(`_probe/${job.id}.ok`).catch(() => false);
      }
      clearInterval(hb);
      await queue.succeed(job.id, result);
      log.info({ jobId: job.id, type: job.type }, "任务完成");
    } catch (err) {
      clearInterval(hb);
      const message = (err as Error).message ?? String(err);
      const outcome = await queue.fail(job.id, message);
      log.error(
        { jobId: job.id, type: job.type, attempt: job.attempts, outcome },
        `任务失败：${message}`
      );
    }
  }

  log.info("worker 收到退出信号，停止认领新任务（在途任务由新实例租约接管）");
  await pool.end().catch(() => undefined);
}
