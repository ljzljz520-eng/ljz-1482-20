import { NavLink, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "../store/auth";

const NAV = [
  { to: "/", label: "创作工作台", end: true },
  { to: "/self-check", label: "部署自检" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-500 text-sm font-bold text-white shadow-sm">
                创
              </span>
              <span className="text-sm font-semibold tracking-wide text-slate-800">
                创作工作台 · 部署可观测
              </span>
            </div>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm transition ${
                      isActive
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span className="hidden text-slate-500 sm:inline">
                  {user.displayName}
                  <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-400">
                    租户隔离
                  </span>
                </span>
                <button
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
                >
                  退出
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-400">未登录</span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-5 pb-10 text-center text-xs text-slate-400">
        所有数据请求均访问真实后端；后端不可用时显示原因，不会切换到假数据。
      </footer>
    </div>
  );
}
