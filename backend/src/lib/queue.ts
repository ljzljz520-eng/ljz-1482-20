import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config/env.js";

export const queueConnection = config.redisUrl
  ? new Redis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true })
  : null;

queueConnection?.on("error", (error) => process.stderr.write(`${JSON.stringify({ level: "error", source: "queue-redis", message: error.message })}\n`));

export const exportQueue = config.redisUrl
  ? new Queue(config.exportQueueName, {
      prefix: config.redisQueuePrefix,
      connection: queueConnection!,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 }
      }
    })
  : null;

const queueEventsConnection = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: null }) : null;
queueEventsConnection?.on("error", (error) => process.stderr.write(`${JSON.stringify({ level: "error", source: "queue-events-redis", message: error.message })}\n`));

export const queueEvents = config.redisUrl && queueEventsConnection
  ? new QueueEvents(config.exportQueueName, { prefix: config.redisQueuePrefix, connection: queueEventsConnection })
  : null;

export async function queuePing(timeoutMs = 5000) {
  if (!exportQueue || !queueEvents) throw new Error("REDIS_URL 未配置，无法验证持久队列消费。");
  const started = Date.now();
  const job = await exportQueue.add("queue-probe", { at: new Date().toISOString() }, {
    jobId: `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`
  });
  await job.waitUntilFinished(queueEvents, timeoutMs);
  return { latencyMs: Date.now() - started, jobId: job.id };
}

export async function enqueueExport(exportId: string, payload: Record<string, unknown>) {
  if (!exportQueue) throw new Error("REDIS_URL 未配置，导出任务不能进入持久队列。");
  return exportQueue.add("export-project", payload, { jobId: `export-${exportId}` });
}
