export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface CheckItem {
  name: string;
  status: CheckStatus;
  detail: string;
  reason?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface SelfCheckResponse {
  status: CheckStatus;
  checks: CheckItem[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { assets: number; exports: number };
}

export interface Asset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  objectKey: string;
}

export interface ExportJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string | null;
  outputKey?: string | null;
  downloadUrl?: string;
  downloadExpiresAt?: string;
  createdAt: string;
}
