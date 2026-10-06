import { Redis } from "ioredis";
import { Worker, type Job } from "bullmq";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { exportQueue, enqueueExport } from "./lib/queue.js";
import { processExport, reconcileQueuedExports, recoverStaleExports } from "./services/exportService.js";

if (!config.redisUrl || !config.databaseUrl || !config.s3.endpoint) {
  logger.error("Worker refusing to start: required environment variables are missing", {
    redisReady: Boolean(config.redisUrl),
    databaseReady: Boolean(config.databaseUrl),
    storageReady: Boolean(config.s3.endpoint)
  });
  process.exit(1);
}

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null, retryStrategy: () => 2000 });
connection.on("error", (error) => logger.error("Worker Redis connection error", { error: error.message }));
const worker = new Worker(
  config.exportQueueName,
  async (job: Job) => {
    if (job.name === "queue-probe") {
      return { consumedBy: config.workerId, at: new Date().toISOString() };
    }
    const exportId = String(job.data.exportId ?? "");
    if (!exportId) throw new Error("Export job payload missing exportId");
    await processExport(exportId);
    return { exportId, consumedBy: config.workerId };
  },
  {
    prefix: config.redisQueuePrefix,
    connection,
    concurrency: 2,
    lockDuration: 60_000,
    stalledInterval: 15_000,
    maxStalledCount: 3
  }
);

worker.on("ready", () => logger.info("Export worker ready", { workerId: config.workerId, queue: config.exportQueueName }));
worker.on("completed", (job) => logger.info("Queue job completed", { jobId: job.id, name: job.name }));
worker.on("failed", (job, error) => logger.error("Queue job failed", { jobId: job?.id, error: error.message }));
worker.on("error", (error) => logger.error("Worker error", { error: error.message }));

async function reconcile() {
  await recoverStaleExports(config.workerId);
  await reconcileQueuedExports(async (exportId, payload) => {
    const bullId = `export-${exportId}`;
    const existing = await exportQueue?.getJob(bullId);
    const state = existing ? await existing.getState() : "missing";
    if (!existing || state === "completed" || state === "failed" || state === "unknown") {
      await existing?.remove();
      await enqueueExport(exportId, payload);
    }
  });
}

const recoveryTimer = setInterval(() => {
  reconcile().catch((error) => logger.error("Scheduled recovery failed", { error: error instanceof Error ? error.message : String(error) }));
}, 20_000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Worker shutdown started; in-flight jobs remain durable in PostgreSQL and Redis", { signal });
  clearInterval(recoveryTimer);
  await worker.close(true);
  await connection.quit();
  await exportQueue?.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

reconcile().catch((error) => logger.error("Startup recovery failed", { error: error instanceof Error ? error.message : String(error) }));
