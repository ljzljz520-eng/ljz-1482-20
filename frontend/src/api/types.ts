export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: string;
  tenantId: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  checksum: string | null;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  error: string | null;
  result: { exportName?: string; exportKey?: string; zipBytes?: number; assetCount?: number } | null;
  heartbeatAt: string | null;
  leasedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
  meta?: Record<string, unknown>;
}

export interface SelfCheckResponse {
  ok: true;
  runtime: {
    env: string;
    apiVersion: string;
    minClientVersion: string;
    buildSha: string;
    storageBucketIsolated: string;
    callbackBase: string;
    presignTtlSeconds: number;
  };
  scope: { tenantId: string };
  checks: CheckResult[];
  summary: { pass: number; fail: number; warn: number; healthy: boolean };
}

export interface VersionInfo {
  ok: true;
  env: string;
  apiVersion: string;
  minClientVersion: string;
  buildSha: string;
  clientVersion: string | null;
  compatible: boolean;
}
