import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { describeError, http } from "../api/client";
import type { Asset, Job, Project } from "../api/types";
import { useAuth } from "../store/auth";
import StatePanel from "../components/StatePanel";

export default function Workbench() {
  const { user, token, login, logout, loading: authLoading, error: authError } = useAuth();
  if (!token || !user) return <LoginCard loading={authLoading} error={authError} onLogin={login} onSkip={() => undefined} />;
  return <ProjectsView />;
}

function LoginCard({
  loading,
  error,
  onLogin,
}: {
  loading: boolean;
  error: string | null;
  onLogin: (u: string, p: string) => Promise<boolean>;
  onSkip: () => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456");
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">登录创作工作台</h1>
        <p className="mt-1 text-sm text-slate-500">
          演示账号 admin / 123456（演示工作室）；另一租户 admin2 / 123456，用于验证隔离。
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await onLogin(username.trim(), password);
            if (ok) toast.success("登录成功，已建立租户隔离会话");
          }}
        >
          <label className="block">
            <span className="text-xs font-medium text-slate-500">用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="admin"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}
          <button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 active:scale-[0.99]"
          >
            {loading ? "登录中…" : "登录"}
          </button>
          <p className="text-center text-[11px] text-slate-400">
            所有数据来自真实后端；后端缺失时会直接报错，不会切换假数据。
          </p>
        </form>
      </div>
    </div>
  );
}

function ProjectsView() {
  const { logout } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await http.get("/api/projects");
      const items = (res.data.items ?? []) as Project[];
      setProjects(items);
      setLoadError(null);
      setActiveId((prev) => prev ?? items[0]?.id ?? null);
    } catch (err) {
      setLoadError(describeError(err).reason);
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createProject = async () => {
    if (!name.trim()) return toast.error("项目名称不能为空");
    setCreating(true);
    try {
      const res = await http.post("/api/projects", { name: name.trim(), description: desc.trim() });
      toast.success("项目已真实创建并落库");
      setName("");
      setDesc("");
      await reload();
      setActiveId((res.data.item.id as string));
    } catch (err) {
      toast.error(describeError(err).reason);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">项目与素材</h1>
        <p className="mt-1 text-sm text-slate-500">
          短操作（建项目/上传）在请求内完成；转码导出走持久队列，由独立 worker 执行，关掉网页或重启服务后任务仍会续接。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="新项目名称"
            className="w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={500}
            placeholder="项目描述（可选）"
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={createProject}
            disabled={creating}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 active:scale-[0.98]"
          >
            {creating ? "创建中…" : "创建项目"}
          </button>
          <button
            onClick={() => {
              logout();
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
          >
            切换租户
          </button>
        </div>
      </section>

      {loadError && (
        <StatePanel
          tone="error"
          title="项目列表不可用"
          reason={
            <>
              <p>{loadError}</p>
              <p className="mt-1">这是真实后端返回的不可用原因，工作台不会使用本地假数据填充列表。</p>
            </>
          }
          action={
            <button onClick={reload} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">
              重试连接
            </button>
          }
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">项目</p>
          {projects === null ? (
            <div className="space-y-2 p-2">
              <div className="h-9 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-9 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : projects.length === 0 && !loadError ? (
            <p className="p-3 text-xs text-slate-400">还没有项目，先创建一个。</p>
          ) : (
            <ul className="space-y-1">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setActiveId(p.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      activeId === p.id
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{p.description || "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        {activeId && <ProjectDetail projectId={activeId} />}
      </div>
    </div>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [download, setDownload] = useState<{ url: string; ttl: number } | null>(null);

  const reloadAssets = useCallback(async () => {
    try {
      const res = await http.get(`/api/projects/${projectId}/assets`);
      setAssets(res.data.items as Asset[]);
      setAssetError(null);
    } catch (err) {
      setAssetError(describeError(err).reason);
    }
  }, [projectId]);

  useEffect(() => {
    setAssets(null);
    setExportJob(null);
    setDownload(null);
    reloadAssets();
  }, [projectId, reloadAssets]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const idem = `fe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await http.post(`/api/projects/${projectId}/assets`, fd, {
        headers: { "Content-Type": "multipart/form-data", "X-Idempotency-Key": idem },
        timeout: 30000,
      });
      if (res.data.duplicate) toast("检测到重复回调，服务端已幂等去重", { icon: "♻️" });
      else toast.success(`素材 ${file.name} 已真实写入对象存储并回调登记`);
      await reloadAssets();
    } catch (err) {
      toast.error(describeError(err).reason);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startExport = async () => {
    try {
      const res = await http.post(`/api/projects/${projectId}/exports`, {});
      const jobId = res.data.job.id as string;
      toast.success("导出任务已入持久队列（关掉页面也会继续执行）");
      pollJob(jobId);
    } catch (err) {
      toast.error(describeError(err).reason);
    }
  };

  const pollJob = async (jobId: string) => {
    const tick = async () => {
      try {
        const res = await http.get(`/api/jobs/${jobId}`);
        const job = res.data.job as Job;
        setExportJob(job);
        if (job.status === "succeeded" || job.status === "failed" || job.status === "dead") {
          if (job.status === "succeeded") toast.success("导出完成，可申请限时下载链接");
          else toast.error(`导出未成功：${job.error ?? job.status}`);
          return;
        }
        setTimeout(tick, 1500);
      } catch (err) {
        toast.error(describeError(err).reason);
      }
    };
    tick();
  };

  const requestDownload = async () => {
    if (!exportJob) return;
    try {
      const res = await http.post(`/api/jobs/${exportJob.id}/download`, {});
      setDownload({ url: res.data.downloadUrl, ttl: res.data.expiresInSeconds });
      toast.success(`已签发 ${res.data.expiresInSeconds} 秒有效的下载授权`);
    } catch (err) {
      toast.error(describeError(err).reason);
    }
  };

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">素材与导出</h2>
          <p className="text-xs text-slate-500">文本素材导出时会做 UTF-8 / LF 归一化转码，并与清单一起打包 zip。</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 active:scale-[0.98]"
          >
            {uploading ? "上传中…" : "上传小素材"}
          </button>
          <button
            onClick={startExport}
            disabled={(assets?.length ?? 0) === 0}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
          >
            转码导出（队列）
          </button>
        </div>
      </div>

      {assetError && <StatePanel tone="error" title="素材列表不可用" reason={assetError} />}

      <div>
        {assets === null ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            暂无素材。贯通测试建议：上传一个 .txt 小文件，然后执行转码导出。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-xs text-slate-500">
                    {a.kind.slice(0, 2)}
                  </span>
                  <div>
                    <p className="font-medium text-slate-700">{a.filename}</p>
                    <p className="text-[11px] text-slate-400">{a.sizeBytes} bytes · sha256 {a.checksum?.slice(0, 12)}…</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {exportJob && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                导出任务 <JobStatusBadge status={exportJob.status} />
              </p>
              <p className="mt-1 text-xs text-slate-500">
                任务 ID：<span className="font-mono">{exportJob.id.slice(0, 8)}</span>
                {exportJob.attempts > 0 && <> · 第 {exportJob.attempts} 次尝试（可能经历过重启接管）</>}
                {exportJob.leasedBy && <> · worker：{exportJob.leasedBy}</>}
              </p>
              {exportJob.error && <p className="mt-1 text-xs text-rose-600">失败原因：{exportJob.error}</p>}
            </div>
            {exportJob.status === "succeeded" && (
              <button
                onClick={requestDownload}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 active:scale-[0.98]"
              >
                申请限时下载链接
              </button>
            )}
          </div>
          {download && (
            <a
              href={download.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex max-w-full items-center gap-2 break-all text-xs text-blue-700 underline"
            >
              🔗 {download.url.slice(0, 120)}…（{download.ttl}s 内有效，仅限当前环境桶）
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function JobStatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<Job["status"], string> = {
    queued: "bg-slate-200 text-slate-600 排队中",
    running: "bg-blue-100 text-blue-700 执行中",
    succeeded: "bg-emerald-100 text-emerald-700 已完成",
    failed: "bg-rose-100 text-rose-700 失败待重试",
    dead: "bg-rose-200 text-rose-800 已终止",
  };
  const [cls, label] = [map[status].split(" ").slice(0, -1).join(" "), map[status].split(" ").pop()];
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
