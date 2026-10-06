import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean; message?: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <section className="max-w-lg w-full rounded-3xl bg-white p-8 shadow-card border border-slate-100 text-center">
          <p className="text-3xl">🫧</p>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">页面加载异常</h1>
          <p className="mt-2 text-slate-500">错误已被隔离，刷新后可继续。若后端不可用，请查看部署自检中的明确原因。</p>
          <button onClick={() => window.location.reload()} className="mt-6 rounded-full bg-primary px-5 py-2.5 text-white font-semibold hover:bg-blue-700 active:scale-95 transition">
            刷新页面
          </button>
        </section>
      </main>
    );
  }
}
