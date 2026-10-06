import crypto from "node:crypto";
import { config } from "../config/env.js";

export function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function signCallback(body: string) {
  return crypto.createHmac("sha256", config.callbackSecret).update(body).digest("hex");
}

export function verifyCallbackSignature(rawBody: string, signature: string) {
  if (!signature || !config.callbackSecret) return false;
  const expected = signCallback(rawBody);
  const supplied = signature.replace(/^sha256=/, "");
  try {
    return timingSafeEqualHex(expected, supplied);
  } catch {
    return false;
  }
}

export function signUploadToken(objectKey: string, tenantId: string, expiresAt: number) {
  return crypto.createHmac("sha256", config.callbackSecret)
    .update([tenantId, objectKey, expiresAt].join(":"))
    .digest("hex");
}

export function safeParseExpiry(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function verifyUploadToken(objectKey: string, tenantId: string, expiresAt: number, signature: string) {
  if (Date.now() > expiresAt) return false;
  const expected = signUploadToken(objectKey, tenantId, expiresAt);
  return timingSafeEqualHex(expected, signature.replace(/^sha256=/, ""));
}
