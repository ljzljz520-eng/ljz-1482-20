import { create } from "zustand";
import { http } from "../api/client";
import type { UserInfo } from "../api/types";

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: (() => {
    try {
      const raw = localStorage.getItem("wb.user");
      return raw ? (JSON.parse(raw) as UserInfo) : null;
    } catch {
      return null;
    }
  })(),
  token: localStorage.getItem("wb.token"),
  loading: false,
  error: null,
  async login(username, password) {
    set({ loading: true, error: null });
    try {
      const res = await http.post("/api/auth/login", { username, password });
      const { token, user } = res.data as { token: string; user: UserInfo };
      localStorage.setItem("wb.token", token);
      localStorage.setItem("wb.user", JSON.stringify(user));
      set({ token, user, loading: false });
      return true;
    } catch (err) {
      const reason =
        (err as { response?: { data?: { reason?: string } } }).response?.data?.reason ??
        "登录失败，后端可能不可达";
      set({ loading: false, error: reason });
      return false;
    }
  },
  logout() {
    localStorage.removeItem("wb.token");
    localStorage.removeItem("wb.user");
    set({ user: null, token: null });
  },
}));
