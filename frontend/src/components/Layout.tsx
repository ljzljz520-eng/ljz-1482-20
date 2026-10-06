import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { FolderKanban, Activity, LogOut } from "lucide-react";
import clsx from "clsx";
import { useAuthStore } from "@/store/authStore";

const nav = [
  { to: "/", label: "创作项目", icon: FolderKanban },
  { to: "/self-check", label: "部署自检", icon: Activity }
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-card">
              <FolderKanban size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Creator Workbench</p>
              <h1 className="text-base font-bold text-slate-900">创作工作台</h1>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => clsx(
                "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100"
              )}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-slate-800">{user?.name ?? "未登录"}</p>
              <p className="max-w-44 truncate text-xs text-slate-400">{user?.email}</p>
            </div>
            {user && <button onClick={logout} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-500 hover:border-red-200 hover:text-red-500 transition" aria-label="退出登录">
              <LogOut size={18} />
            </button>}
          </div>
        </div>
      </header>
      <main key={location.pathname} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-7xl px-6 py-8 text-center text-xs text-slate-400">
        预览与正式环境使用独立数据、回调地址、队列前缀和下载授权。
      </footer>
    </div>
  );
}
