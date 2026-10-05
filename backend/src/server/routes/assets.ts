import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { AppConfig } from "../../config/env";
import { getPool } from "../../db/pool";
import { AssetRepo, ProjectRepo } from "../../db/repos";
import { getStorage } from "../../storage/client";
import { authGuard, tenantScope } from "../../auth";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function detectKind(filename: string, mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/") || /\.(txt|md|json|csv)$/i.test(filename)) return "text";
  return "file";
}

export function registerAssetRoutes(app: FastifyInstance, config: AppConfig) {
  const guard = authGuard(config);

  /** 列出项目素材（强制租户 + 项目双校验） */
  app.get("/api/projects/:projectId/assets", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const { projectId } = req.params as { projectId: string };
    const pool = getPool();
    const project = await new ProjectRepo(pool).get(tenantId, projectId);
    if (!project) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", reason: "项目不存在或无权访问。" });
    }
    return { ok: true, items: await new AssetRepo(pool).listForProject(tenantId, projectId) };
  });

  /**
   * 上传 + 回调在同一短请求内完成（小素材）：
   * - 字节真实写入对象存储
   * - 落库走幂等回调通道（idempotencyKey 必填）
   * 大文件/跨存储上传由同一段回调逻辑保证重复安全。
   */
  app.post("/api/projects/:projectId/assets", { preHandler: guard }, async (req, reply) => {
    const tenantId = tenantScope(req);
    const { projectId } = req.params as { projectId: string };
    const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
    if (!idempotencyKey || !/^[\w:-]{8,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({
        ok: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        reason: "上传必须携带 X-Idempotency-Key（8-128 位字母数字/_-:），用于回调去重。",
      });
    }

    const pool = getPool();
    const project = await new ProjectRepo(pool).get(tenantId, projectId);
    if (!project) {
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", reason: "项目不存在或无权访问。" });
    }

    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!data) {
      return reply.code(400).send({ ok: false, code: "NO_FILE", reason: "缺少上传文件（multipart 字段名 file）。" });
    }
    const filename = data.filename.replace(/[^\w.\-一-龥]/g, "_").slice(0, 120);
    const kind = detectKind(filename, data.mimetype);
    const chunks: Buffer[] = [];
    let size = 0;
    const hash = createHash("sha256");
    try {
      for await (const chunk of data.file) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          return reply.code(413).send({ ok: false, code: "FILE_TOO_LARGE", reason: "素材超过 20MB 上限。" });
        }
        hash.update(chunk);
        chunks.push(chunk);
      }
    } catch (err) {
      return reply.code(400).send({ ok: false, code: "UPLOAD_FAILED", reason: `读取上传流失败：${(err as Error).message}` });
    }
    const buffer = Buffer.concat(chunks);
    const checksum = hash.digest("hex");
    const storage = getStorage();
    const storageKey = `tenants/${tenantId}/projects/${projectId}/${Date.now()}-${filename}`;
    await storage.put(storageKey, buffer, buffer.length, data.mimetype);

    const { asset, duplicate } = await new AssetRepo(pool).createFromCallback({
      tenantId,
      projectId,
      filename,
      kind,
      sizeBytes: size,
      storageKey,
      bucket: storage.bucket,
      checksum,
      idempotencyKey,
      payloadHash: checksum,
    });

    req.log.info(
      { tenantId, projectId, assetId: asset.id, duplicate, size },
      "上传回调完成"
    );
    return reply.code(duplicate ? 200 : 201).send({ ok: true, item: asset, duplicate });
  });
}
