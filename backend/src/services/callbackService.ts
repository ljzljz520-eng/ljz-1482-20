import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { headObject } from "../lib/storage.js";
import { sha256 } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

export interface CallbackInput {
  eventId: string;
  tenantId: string;
  provider?: string;
  eventType: string;
  objectKey?: string;
  signatureValid: boolean;
  rawBody: string;
}

export interface CallbackResult {
  eventId: string;
  duplicate: boolean;
  stored: boolean;
  objectReady: boolean | null;
  status: string;
  reason?: string;
}

export async function recordUploadCallback(input: CallbackInput): Promise<CallbackResult> {
  const payloadHash = sha256(input.rawBody);

  try {
    await prisma.webhookEvent.create({
      data: {
        id: input.eventId,
        externalEventId: input.eventId,
        tenantId: input.tenantId,
        provider: input.provider ?? "s3-presigned",
        eventType: input.eventType,
        objectKey: input.objectKey,
        signatureValid: input.signatureValid,
        payloadHash
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        eventId: input.eventId,
        duplicate: true,
        stored: true,
        objectReady: null,
        status: "ignored",
        reason: "回调事件此前已处理，幂等表拒绝重复执行。"
      };
    }
    throw error;
  }

  if (!input.signatureValid) {
    logger.warn("Rejected callback with invalid signature", { eventId: input.eventId });
    return { eventId: input.eventId, duplicate: false, stored: true, objectReady: false, status: "rejected", reason: "签名校验失败。" };
  }

  if (!input.objectKey) {
    return { eventId: input.eventId, duplicate: false, stored: true, objectReady: false, status: "ignored", reason: "回调未包含对象键。" };
  }

  const asset = await prisma.asset.findFirst({ where: { objectKey: input.objectKey, tenantId: input.tenantId } });
  if (!asset) {
    return { eventId: input.eventId, duplicate: false, stored: true, objectReady: false, status: "ignored", reason: "对象未找到对应素材，可能属于其他租户。" };
  }

  try {
    const metadata = await headObject(input.objectKey);
    await prisma.asset.update({
      where: { id: asset.id },
      data: { status: "ready", sizeBytes: Number(metadata.ContentLength ?? asset.sizeBytes) }
    });
    return { eventId: input.eventId, duplicate: false, stored: true, objectReady: true, status: "processed" };
  } catch (error) {
    logger.error("Callback object head failed", { eventId: input.eventId, error: error instanceof Error ? error.message : String(error) });
    return { eventId: input.eventId, duplicate: false, stored: true, objectReady: false, status: "failed", reason: "回调已接收，但对象存储中尚不可读。" };
  }
}
