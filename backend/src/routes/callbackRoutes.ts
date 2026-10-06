import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordUploadCallback } from "../services/callbackService.js";
import { verifyCallbackSignature, verifyUploadToken } from "../lib/crypto.js";

type RawCallbackBody = Record<string, any>;

const directCallbackSchema = z.object({
  eventId: z.string().min(8).max(200),
  tenantId: z.string().min(1),
  objectKey: z.string().min(1),
  expiresAt: z.number().int().positive(),
  token: z.string().min(16),
  eventType: z.string().default("object.created")
});

function readRawJson(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.rawBody ?? "";
  try {
    return { raw, body: JSON.parse(raw) as RawCallbackBody };
  } catch {
    return reply.code(400).send({ error: "INVALID_JSON", message: "回调内容不是有效 JSON。" });
  }
}

export default async function callbackRoutes(app: FastifyInstance) {
  app.post("/callbacks/uploads", async (request, reply) => {
    const parsedBody = readRawJson(request, reply);
    if ("statusCode" in parsedBody) return parsedBody;
    const { raw, body } = parsedBody;
    const headerSignature = String(request.headers["x-callback-signature"] ?? "");
    const signatureValid = verifyCallbackSignature(raw, headerSignature);
    const eventId = String(body.eventId ?? body.Records?.[0]?.responseElements?.xAmzRequestId ?? `s3-${Date.now()}`);
    const objectKey = String(body.objectKey ?? body.Records?.[0]?.s3?.object?.key ?? "");
    const tenantId = String(body.tenantId ?? "");
    if (!tenantId) return reply.code(400).send({ error: "TENANT_REQUIRED", message: "回调缺少租户标识。" });

    const result = await recordUploadCallback({
      eventId,
      tenantId,
      provider: String(body.provider ?? "object-storage"),
      eventType: String(body.eventType ?? "object.created"),
      objectKey: objectKey || undefined,
      signatureValid,
      rawBody: raw
    });
    return reply.code(result.status === "rejected" ? 401 : 200).send(result);
  });

  app.post("/callbacks/uploads/presigned", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = directCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "确认上传参数不完整。", details: parsed.error.flatten() });
    }
    const input = parsed.data;
    if (input.tenantId !== request.user.tenantId) {
      return reply.code(403).send({ error: "TENANT_FORBIDDEN", message: "不能确认其他租户的素材回调。" });
    }
    const valid = verifyUploadToken(input.objectKey, input.tenantId, input.expiresAt, input.token);
    const result = await recordUploadCallback({
      eventId: input.eventId,
      tenantId: input.tenantId,
      provider: "browser-presigned",
      eventType: input.eventType,
      objectKey: input.objectKey,
      signatureValid: valid,
      rawBody: JSON.stringify(input)
    });
    return reply.code(result.status === "rejected" ? 401 : 200).send(result);
  });
}
