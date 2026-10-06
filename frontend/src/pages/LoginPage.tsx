import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Mail } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("Workbench@2026");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="w-full max-w-md rounded-[2rem] border border-white bg-white p-8 shadow-card">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">真实鉴权 · JWT</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">登录创作工作台</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">本地 Docker 默认账号见 README。若后端未启动，会明确显示不可用原因，不使用演示假登录。</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            邮箱
            <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 px-3 focus-within:border-primary">
              <Mail size={18} className="text-slate-400" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="h-12 w-full bg-transparent outline-none" required />
            </div>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            密码
            <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 px-3 focus-within:border-primary">
              <LockKeyhole size={18} className="text-slate-400" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="h-12 w-full bg-transparent outline-none" required />
            </div>
          </label>
          {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button disabled={submitting} className="h-12 w-full rounded-2xl bg-primary font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60">
            {submitting ? "登录中..." : "登录并连接真实服务"}
          </button>
        </form>
      </div>
    </div>
  );
}
