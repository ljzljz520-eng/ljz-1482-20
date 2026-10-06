import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import { ExportJob, Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { getObject, putObject } from "../lib/storage.js";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ExportProcessingError extends Error {}

async function updateExport(exportId: string, data: Prisma.ExportJobUpdateInput) {
  return prisma.exportJob.update({ where: { id: exportId }, data });
}

function runFfmpeg(args: string[], timeoutMs = 120_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ExportProcessingError("ffmpeg 执行超时"));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ExportProcessingError(stderr || `ffmpeg exited ${code}`));
    });
  });
}

export async function processExport(exportId: string) {
  const job = await prisma.exportJob.findUnique({ where: { id: exportId }, include: { project: { include: { assets: { where: { status: "ready" } } } } } });
  if (!job) throw new ExportProcessingError(`Export ${exportId} not found`);
  if (job.status === "succeeded") {
    logger.info("Export already succeeded, skipping", { exportId });
    return;
  }
  if (job.project.assets.length === 0) throw new ExportProcessingError("No ready assets to export");

  const workdir = path.join(os.tmpdir(), `creator-export-${exportId}-${nanoid(8)}`);
  await mkdir(workdir, { recursive: true });
  try {
    await updateExport(exportId, {
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      lockedBy: config.workerId,
      lockedAt: new Date(),
      heartbeatAt: new Date(),
      attempt: { increment: 1 },
      error: null,
      progress: 5
    });

    const normalized: string[] = [];
    for (let index = 0; index < job.project.assets.length; index += 1) {
      const asset = job.project.assets[index];
      const sourcePath = path.join(workdir, `source-${index}${path.extname(asset.filename) || ".bin"}`);
      const object = await getObject(asset.objectKey);
      if (!object.Body) throw new ExportProcessingError(`Cannot download ${asset.filename}`);
      await pipeline(object.Body as Readable, createWriteStream(sourcePath));

      const base = `asset-${index + 1}`;
      const outputPath = path.join(workdir, `${base}.txt`);
      if (asset.mimeType.startsWith("audio/") || asset.mimeType.startsWith("video/")) {
        const mediaTarget = path.join(workdir, `${base}.mp3`);
        await runFfmpeg(["-i", sourcePath, "-vn", "-acodec", "libmp3lame", "-ab", "64k", "-ar", "22050", mediaTarget]);
        normalized.push(mediaTarget);
      } else if (asset.mimeType.startsWith("image/")) {
        const imageTarget = path.join(workdir, `${base}.jpg`);
        await runFfmpeg(["-i", sourcePath, "-vf", "scale='min(1280,iw)':-2", imageTarget]);
        normalized.push(imageTarget);
      } else {
        const content = await readFile(sourcePath);
        await writeFile(outputPath, content);
        normalized.push(outputPath);
      }
      await updateExport(exportId, { progress: 10 + Math.round(((index + 1) / job.project.assets.length) * 60), heartbeatAt: new Date() });
      await sleep(150);
    }

    const manifestPath = path.join(workdir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      exportId,
      projectId: job.projectId,
      projectName: job.project.name,
      environment: config.env,
      generatedAt: new Date().toISOString(),
      assets: job.project.assets.map((asset) => ({ id: asset.id, filename: asset.filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }))
    }, null, 2));

    await updateExport(exportId, { progress: 78, heartbeatAt: new Date() });
    const zipPath = path.join(workdir, "export.zip");
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      archive.on("error", reject);
      archive.pipe(output);
      for (const file of [...normalized, manifestPath]) archive.file(file, { name: path.basename(file) });
      void archive.finalize();
    });

    await updateExport(exportId, { progress: 88, heartbeatAt: new Date() });
    const outputKey = `tenants/${job.tenantId}/exports/${exportId}.zip`;
    const zipBuffer = await readFile(zipPath);
    await putObject(outputKey, zipBuffer, "application/zip");

    await updateExport(exportId, {
      status: "succeeded",
      progress: 100,
      outputKey,
      outputSize: zipBuffer.length,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
      lockedBy: null,
      lockedAt: null,
      error: null
    });
    logger.info("Export succeeded", { exportId, outputKey, size: zipBuffer.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知导出错误";
    const attempt = job.attempt + 1;
    const willRetry = attempt < 3;
    await updateExport(exportId, {
      status: willRetry ? "running" : "failed",
      error: willRetry ? `等待 BullMQ 第 ${attempt + 1} 次重试：${message}` : message,
      finishedAt: willRetry ? null : new Date(),
      heartbeatAt: willRetry ? new Date() : null,
      lockedBy: willRetry ? config.workerId : null,
      lockedAt: willRetry ? new Date() : null
    });
    logger.error("Export processing attempt failed", { exportId, attempt, willRetry, error: message });
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function recoverStaleExports(workerId = config.workerId) {
  const cutoff = new Date(Date.now() - config.lockTtlMs);
  const stale = await prisma.exportJob.findMany({
    where: { status: "running", heartbeatAt: { lt: cutoff } },
    take: 20,
    orderBy: { queuedAt: "asc" }
  });
  for (const job of stale) {
    await prisma.exportJob.updateMany({
      where: { id: job.id, status: "running", heartbeatAt: { lt: cutoff } },
      data: { status: "queued", lockedBy: null, lockedAt: null, heartbeatAt: null }
    });
    logger.warn("Recovered stale export", { exportId: job.id, oldWorker: job.lockedBy, newWorker: workerId });
  }
}

export async function reconcileQueuedExports(ensureJob: (exportId: string, payload: { exportId: string; projectId: string; tenantId: string }) => Promise<unknown>) {
  const queued = await prisma.exportJob.findMany({
    where: { status: "queued" },
    take: 50,
    orderBy: { queuedAt: "asc" }
  });
  for (const job of queued) {
    await ensureJob(job.id, { exportId: job.id, projectId: job.projectId, tenantId: job.tenantId });
  }
}
