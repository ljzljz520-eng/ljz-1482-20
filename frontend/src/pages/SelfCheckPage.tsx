import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Database, HardDrive, Repeat, GitBranch, Webhook, Globe, Settings2 } from "lucide-react";
import { selfCheck } from "@/api/workbench";
import { getApiError } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import type { CheckItem } from "@/types/api";

const icons: Record<string, typeof ShieldCheck> = {
  version: GitBranch,
  configuration: Settings2,
  cors: Globe,
  auth: ShieldCheck,
  database: Database,
  objectStorage: HardDrive,
  queueConsumer: Repeat,
  uploadCallback: Webhook,
  jobRecovery: Repeat
};

const labels: Record<string, string> = {
  version: "版本兼容",
  configuration: "环境配置",
  cors: "跨域策略",
  auth: "鉴权与租户",
  database: "关系数据库与迁移",
  objectStorage: "对象存储与下载授权",
  queueConsumer: "队列消费",
  uploadCallback: "上传回调与去重",
  jobRecovery: "重启续接"
};

const sensitiveKeyPattern = /secret|token|password|key/i;

function redactMeta(meta: CheckItem["meta"]) {
  return Object.entries(meta ?? {}).map(([key, value]) => {
    if (sensitiveKeyPattern.test(key) && typeof value === "string" && value !== "ready" && value !== "missing") return [key, "<redacted>"];
    if (typeof value === "object") return [key, "<omitted>"];
    return [key, value];
  });
}

export default function SelfCheckPage() {
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const result = await selfCheck();
      setChecks(result.checks);
      setStatus("done");
    } catch (reason) {
      setError(getApiError(reason));
      setChecks([]);
      setStatus("done");
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-orange-500 p-8 text-white shadow-card">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white/75">Deployment Self Check</p>
            <h2 className="mt-2 text-3xl font-bold">部署自检与真实链路验收</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/85">检查版本、鉴权、CORS、Postgres 迁移、对象存储短时授权、上传回调幂等，以及 Redis 持久队列是否由独立 worker 消费。密钥只显示 ready/missing。</p>
          </div>
          <button onClick={() => void run()} disabled={status === "loading"} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-900 shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60">
            <RefreshCw size={17} className={status === "loading" ? "animate-spin" : ""} /> 重新自检
          </button>
        </div>
      </section>

      {status === "loading" && <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-white" />)}</div>}

      {error && <section className="rounded-3xl border border-red-100 bg-red-50 p-6">
        <h3 className="text-lg font-bold text-red-800">真实服务不可用</h3>
        <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>
        <p className="mt-2 text-sm font-medium text-red-700">页面不会切换到本地假数据或将失败显示为成功。请检查 API 地址、环境变量、CORS_ORIGIN 及登录状态。</p>
      </section>}

      {!error && checks.length > 0 && <div className="grid gap-4 lg:grid-cols-2">
        {checks.map((check) => {
          const Icon = icons[check.name] ?? ShieldCheck;
          return (
            <article key={check.name} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card transition hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon size={21} /></div>
                  <div>
                    <h3 className="font-bold text-slate-900">{labels[check.name] ?? check.name}</h3>
                    <p className="text-xs text-slate-400">{check.name}</p>
                  </div>
                </div>
                <StatusBadge status={check.status} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{check.detail}</p>
              {check.reason && <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">原因：{check.reason}</p>}
              {check.meta && <dl className="mt-4 grid gap-2 rounded-2xl bg-slate-50 p-4 text-xs">
                {redactMeta(check.meta).map(([key, value]) => <div key={String(key)} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{key}</dt>
                  <dd className="max-w-[65%] truncate text-right font-medium text-slate-700">{String(value)}</dd>
                </div>)}
              </dl>}
            </article>
          );
        })}
      </div>}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-6">
          <h3 className="font-bold text-blue-900">请求内短操作</h3>
          <p className="mt-2 text-sm leading-6 text-blue-800">登录、创建项目、申请上传 URL、读取状态都在普通 HTTP 请求中完成并立即返回；失败会返回明确状态码和原因。</p>
        </div>
        <div className="rounded-3xl border border-orange-100 bg-orange-50/70 p-6">
          <h3 className="font-bold text-orange-900">持久队列长任务</h3>
          <p className="mt-2 text-sm leading-6 text-orange-800">转码导出由独立 worker 从 BullMQ 领取，状态、锁和心跳存 Postgres。SIGTERM、换版或网页关闭后，启动恢复与 30 秒扫描会重新认领 queued 和心跳超时 running 任务。</p>
        </div>
      </section>
    </div>
  );
}
