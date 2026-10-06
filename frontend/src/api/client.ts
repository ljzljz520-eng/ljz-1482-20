import axios, { type AxiosError } from "axios";

export const CLIENT_VERSION = "1.0.0";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
  timeout: 20_000,
  headers: { "X-Client-Version": CLIENT_VERSION }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("workbench.token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    if (error.response?.status === 401 && !error.config?.url?.includes("/auth/login")) {
      localStorage.removeItem("workbench.token");
    }
    return Promise.reject(error);
  }
);

export function getApiError(error: unknown, fallback = "真实后端暂不可用，页面不会切换为假数据。") {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
