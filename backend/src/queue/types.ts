export type JobType = "export" | "probe";

export interface ExportPayload {
  projectId: string;
  exportKey: string;
  exportName: string;
  simulateDelayMs?: number;
}

export interface ProbePayload {
  probe: true;
  nonce: string;
}

export type JobPayload = ExportPayload | ProbePayload;

export interface JobRecord {
  id: string;
  tenantId: string;
  type: JobType;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  payload: JobPayload;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  leasedBy: string | null;
  heartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export const TENANT_SCOPED_COLUMNS = "tenant_id = $TENANT" as const;
