import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import SelfCheckPage from "./pages/SelfCheckPage";
import { useAuthStore } from "./store/authStore";

function RequireAuth() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const hydrate = useAuthStore((state) => state.hydrate);
  const loading = useAuthStore((state) => state.loading);

  useEffect(() => { if (token && !user) void hydrate(); }, [token, user, hydrate]);

  if (token && loading && !user) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">正在恢复登录状态并连接真实 API...</div>;
  }
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

const App = () => (
  <BrowserRouter>
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/self-check" element={<SelfCheckPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" toastOptions={{ className: "text-sm" }} />
    </ErrorBoundary>
  </BrowserRouter>
);

export default App;
