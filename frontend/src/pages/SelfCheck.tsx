import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { describeError, http } from "../api/client";
import type { SelfCheckResponse, VersionInfo } from "../api/types";
import CheckCard from "../components/CheckCard";
import StatePanel from "../components/StatePanel";
import { useAuth } from "../store/auth";

const SECRET_LABELS: Record<string, string> = {
  JWT_SECRET: "JWT 密钥",
  DATABASE_URL: "数据库连接串",
  S3_ACCESS_KEY: "对象存储 AK",
  S3_SECRET_KEY: "对象存储 SK",
};

export default function SelfCheck() {
  const { user, token } = useAuth();
  const [data, setData] = useState<SelfCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deep, setDeep] = useState<SelfCheckResponse | null>(null);

  const loadVersion = useCallback(async () => {
    try {
      const res = await http.get("/api/version");
      setVersion(res.data);
      setVersionError(null);
    } catch (err) {
      setVersionError(describeError(err).reason);
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await http.get<SelfCheckResponse>("/api/selfcheck");
      setData(res.data);
    } catch (err) {
      const info = describeError(err);
      setError(info.reason);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const runDeepProbes = async () => {
    setDeepLoading(true);
    try {
      const res = await http.post<SelfCheckResponse>("/api/selfcheck/run-probes", {});
      setDeep(res.data);
      toast.success("贯通探针执行完成（真实建项目/上传回调/队列消费）");
      load();
    } catch (err) {
      toast.error(describeError(err).reason);
    } finally {
      setDeepLoading(false);
    }
  };

  const configCheck = data?.checks.find((c) => c.key === "config");
  const secrets = (configCheck?.meta?.secrets ?? null) as Record<string, boolean> | null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">部署自检</h1>
            <p className="mt-1 text-sm text-slate-500">
              版本兼容 · 鉴权 · 上传回调（含重复回调）· 队列消费。所有探测真实执行；敏感配置只显示就绪状态，不下发任何密钥值。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadVersion}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
            >
              刷新版本
            </button>
            <button
              onClick={load}
              disabled={!token || loading}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
            >
              {loading ? "检测中…" : "重新自检"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <InfoTile
            label="运行环境"
            value={data ? data.runtime.env : version?.env ?? "—"}
            hint="preview / production 数据隔离"
          />
          <InfoTile
            label="API / 最低前端"
            value={
              version
                ? `${version.apiVersion} / ≥${version.minClientVersion}`
                : "不可达"
          }
            hint={version ? `构建 ${version.buildSha}` : versionError ?? undefined}
            tone={versionError ? "bad" : version?.compatible === false ? "bad" : undefined}
          />
          <InfoTile
            label="回调基址 & 下载授权"
            value={data ? data.runtime.callbackBase || "未配置" : "—"}
            hint={data ? `预签名 ${data.runtime.presignTtlSeconds}s · 桶 ${data.runtime.storageBucketIsolated}` : undefined}
          />
        </div>
      </section>

      {!user && (
        <StatePanel
          tone="warning"
          title="需要登录后查看租户级自检结果"
          reason="自检数据严格按租户隔离。请在「创作工作台」页登录后回到本页；未登录不会展示任何后端运维信息。"
        />
      )}

      {!loading && error && (
        <StatePanel
          tone="error"
          title="自检不可用（没有伪造结果）"
          reason={
            <ul className="list-inside list-disc space-y-1">
              <li>{error}</li>
              <li>常见原因：后端未启动、VITE_API_BASE 未指向真实 API、跨域来源未加入 CORS_ORIGINS。</li>
              <li>系统不会切换到本地假数据冒充成功。</li>
            </ul>
          }
          action={
            <button onClick={load} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">
              重试
            </button>
          }
        />
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">敏感配置就绪性（仅布尔）</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["JWT_SECRET", "DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const).map((key) => {
            const ready = secrets?.[key];
            return (
              <div
                key={key}
                className={`rounded-2xl border p-4 ${
                  ready === undefined
                    ? "border-slate-200 bg-slate-50"
                    : ready
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-rose-200 bg-rose-50/60"
                }`}
              >
                <p className="text-xs text-slate-500">{SECRET_LABELS[key]}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {ready === undefined ? "未检测" : ready ? "✅ 已就绪" : "❌ 未就绪"}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{key}=••••••</p>
              </div>
            );
          })}
        </div>
      </section>

      {loading && !data && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            {data.checks.map((c) => (
              <CheckCard key={c.key} check={c} />
            ))}
          </section>
          <p className="text-xs text-slate-400">
            自检范围：{data.scope.tenantId}。结果中不包含任何其他租户的项目、任务或存储信息。
          </p>
        </>
      )}

      {user && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">深度贯通探针</h2>
              <p className="mt-1 text-xs text-slate-500">
                真实创建 [自检] 项目 → 上传字节到对象存储 → 两次同 key 回调验证幂等 → 投递探针任务等待 worker 消费。
              </p>
            </div>
            <button
              onClick={runDeepProbes}
              disabled={deepLoading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 active:scale-[0.98]"
            >
              {deepLoading ? "探针执行中（最多 20s）…" : "执行贯通探针"}
            </button>
          </div>
          {deep && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {deep.checks.map((c) => (
                <CheckCard key={c.key} check={c} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function InfoTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bad";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tone === "bad" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-slate-50/70"
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${tone === "bad" ? "text-rose-700" : "text-slate-800"}`}>
        {value}
      </p>
      {hint && <p className="mt-1 truncate text-[11px] text-slate-400" title={hint}>{hint}</p>}
    </div>
  );
}
