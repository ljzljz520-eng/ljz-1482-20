import { api } from "./client";
import type { Asset, AuthUser, ExportJob, Project, SelfCheckResponse } from "@/types/api";

export const login = async (email: string, password: string) => {
  const response = await api.post<{ token: string; user: AuthUser & { tenant: { id: string; name: string } }; environment: string }>("/auth/login", { email, password });
  return { ...response.data, user: { ...response.data.user, tenantId: response.data.user.tenantId ?? response.data.user.tenant.id } };
};

export const fetchMe = async () => (await api.get<AuthUser>("/auth/me")).data;
export const selfCheck = async () => (await api.get<SelfCheckResponse>("/system/self-check")).data;
export const fetchProjects = async () => (await api.get<{ items: Project[] }>("/projects")).data.items;

export const createProject = async (payload: { name: string; description?: string }) =>
  (await api.post<Project>("/projects", payload)).data;

export const fetchProject = async (id: string) => (await api.get<Project & { assets: Asset[]; exports: ExportJob[] }>(`/projects/${id}`)).data;

interface UploadUrlResponse {
  asset: Asset;
  uploadUrl: string;
  headers: Record<string, string>;
  callbackConfirmation: {
    url: string;
    expiresAt: number;
    objectKey: string;
    tenantId: string;
    token: string;
  };
}

export async function uploadAsset(projectId: string, file: File) {
  const { data } = await api.post<UploadUrlResponse>("/assets/upload-url", {
    projectId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size
  });
  await axiosPut(data.uploadUrl, file, data.headers);
  const eventId = `${data.asset.id}-${crypto.randomUUID()}`;
  const callback = await api.post(data.callbackConfirmation.url, {
    eventId,
    tenantId: data.callbackConfirmation.tenantId,
    objectKey: data.callbackConfirmation.objectKey,
    expiresAt: data.callbackConfirmation.expiresAt,
    token: data.callbackConfirmation.token,
    eventType: "object.created"
  });
  return { asset: data.asset, callback: callback.data };
}

async function axiosPut(url: string, body: File, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "PUT",
    body,
    headers
  });
  if (!response.ok) throw new Error(`对象存储拒绝上传（${response.status}），请检查跨域和桶授权。`);
}

export const createExport = async (projectId: string) => {
  const idempotencyKey = `export-${projectId}-${new Date().toISOString().slice(0, 16).replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  return (await api.post<{ job: ExportJob }>("/exports", { projectId, idempotencyKey })).data.job;
};

export const fetchExport = async (id: string) => (await api.get<ExportJob>(`/exports/${id}`)).data;
