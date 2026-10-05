import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { getPool } from "../db/pool";
import { getStorage } from "../storage/client";
import { AssetRepo, ProjectRepo } from "../db/repos";
import { ExportPayload, JobRecord } from "../queue/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`素材超过导出大小上限（${maxBytes} bytes）`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * 转码导出：
 * - 文本类素材统一规整为 UTF-8（CRLF -> LF）并生成 JSON 清单（真实轻量转码，非 Mock）
 * - 全部素材打包为 zip 写回对象存储
 * - 任务状态/结果只依赖数据库与对象存储，进程重启后由租约接管继续或重试，
 *   不依赖任何网页或短请求保持在线
 */
export async function runExport(job: JobRecord, raw: ExportPayload): Promise<Record<string, unknown>> {
  const pool = getPool();
  const storage = getStorage();
  const projects = new ProjectRepo(pool);
  const assets = new AssetRepo(pool);

  const project = await projects.get(job.tenantId, raw.projectId);
  if (!project) throw new Error(`项目不存在或不属于当前租户: ${raw.projectId}`);
  const assetRows = await assets.listForProject(job.tenantId, raw.projectId);

  // 长任务演练：部署换版/进程重启期间的在途任务会因租约过期被新 worker 接管重试
  const delay = Math.max(0, Number(raw.simulateDelayMs ?? 0));
  if (delay > 0) await sleep(delay);

  const zip = new AdmZip();
  const sha = createHash("sha256");
  let totalBytes = 0;
  const manifestEntries: Array<Record<string, unknown>> = [];

  for (const asset of assetRows) {
    const remote = await storage.getStream(asset.storageKey);
    const buf = await streamToBuffer(remote, 50 * 1024 * 1024);
    totalBytes += buf.length;
    sha.update(buf);
    const normalized =
      asset.kind === "text"
        ? Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8")
        : buf;
    zip.addFile(`assets/${asset.filename}`, normalized);
    manifestEntries.push({
      assetId: asset.id,
      filename: asset.filename,
      kind: asset.kind,
      sizeBytes: asset.sizeBytes,
      checksum: asset.checksum,
    });
  }

  const manifest = {
    projectId: project.id,
    projectName: project.name,
    exportedAt: new Date().toISOString(),
    environment: process.env.APP_ENV ?? "preview",
    assetCount: assetRows.length,
    assets: manifestEntries,
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  const zipBuffer = zip.toBuffer();

  await storage.put(raw.exportKey, zipBuffer, zipBuffer.length, "application/zip");
  const stat = await storage.stat(raw.exportKey);

  return {
    projectId: project.id,
    exportName: raw.exportName,
    exportKey: raw.exportKey,
    bucket: storage.bucket,
    assetCount: assetRows.length,
    sourceBytes: totalBytes,
    zipBytes: stat.size,
    checksum: sha.digest("hex"),
  };
}
