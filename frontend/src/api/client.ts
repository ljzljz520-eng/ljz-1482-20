import axios, { AxiosError } from "axios";

export const APP_VERSION = "1.4.0";

const baseURL = import.meta.env.VITE_API_BASE || "";

export const http = axios.create({
  baseURL,
  timeout: 20000,
});

http.interceptors.request.use((config) => {
  config.headers.set("X-Client-Version", APP_VERSION);
  const token = localStorage.getItem("wb.token");
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

export interface ApiError {
  ok: false;
  code: string;
  reason: string;
  status?: number;
}

export function describeError(err: unknown, fallback = "网络异常，请检查后端是否可用"): ApiError {
  const ax = err as AxiosError<{ code?: string; reason?: string }>;
  if (ax?.response) {
    return {
      ok: false,
      status: ax.response.status,
      code: ax.response.data?.code ?? `HTTP_${ax.response.status}`,
      reason:
        ax.response.data?.reason ??
        (ax.response.status === 503
          ? "后端依赖未就绪（数据库/存储/配置），请查看自检页的不可用原因"
          : fallback),
    };
  }
  if (ax?.code === "ERR_NETWORK") {
    return {
      ok: false,
      status: 0,
      code: "BACKEND_UNREACHABLE",
      reason: "无法连接后端服务（不是鉴权失败，是网络/服务不可达）。预览需配置 VITE_API_BASE 或 Vite 代理。",
    };
  }
  return { ok: false, code: "UNKNOWN", reason: ax?.message ?? fallback };
}
