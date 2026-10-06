import { create } from "zustand";
import { login as loginRequest, fetchMe } from "@/api/workbench";
import type { AuthUser } from "@/types/api";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem("workbench.token"),
  loading: false,
  error: null,
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const result = await loginRequest(email, password);
      localStorage.setItem("workbench.token", result.token);
      set({ token: result.token, user: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role, tenantId: result.user.tenantId }, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      set({ loading: false, error: message });
      throw error;
    }
  },
  logout: () => {
    localStorage.removeItem("workbench.token");
    set({ token: null, user: null });
  },
  hydrate: async () => {
    const token = localStorage.getItem("workbench.token");
    if (!token) return;
    set({ loading: true });
    try {
      const user = await fetchMe();
      set({ user, loading: false });
    } catch {
      localStorage.removeItem("workbench.token");
      set({ token: null, user: null, loading: false });
    }
  }
}));
