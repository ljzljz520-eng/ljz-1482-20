import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, CloudUpload, FolderPlus, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { createExport, createProject, fetchExport, fetchProjects, uploadAsset } from "@/api/workbench";
import { getApiError } from "@/api/client";
import { createSmallWavFile } from "@/utils/wav";
import type { ExportJob, Project } from "@/types/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState("");
  const [selected, setSelected] = useState<Project | null>(null);
  const [assetsCount, setAssetsCount] = useState(0);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [smokeLog, setSmokeLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProjects(await fetchProjects());
    } catch (reason) {
      setError(getApiError(reason, "项目服务不可用；不会显示模拟项目。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); return () => { if (pollRef.current) window.clearInterval(pollRef.current); }; }, [load]);

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const project = await createProject({ name: name.trim(), description: "通过真实 API 创建的部署验收项目" });
      setName("");
      setSelected(project);
      setAssetsCount(0);
      setJob(null);
      await load();
    } catch (reason) {
      setError(getApiError(reason));
    } finally {
      setCreating(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selected) return;
    setAction(`上传 ${file.name}`);
    setSmokeLog((items) => [...items, `申请对象存储预签名上传地址：${file.name}`]);
    try {
      await uploadAsset(selected.id, file);
      setAssetsCount((count) => count + 1);
      setSmokeLog((items) => [...items, "对象已上传，回调完成签名校验和素材状态更新。"]);
      await load();
    } catch (reason) {
      setError(getApiError(reason, "上传回调失败，请查看自检的 CORS 与回调结果。"));
    } finally {
      setAction("");
    }
  }

  const poll = useCallback((id: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const current = await fetchExport(id);
        setJob(current);
        if (current.status === "running") setAction(`worker 转码导出中 ${current.progress}%`);
        if (current.status === "succeeded" || current.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setAction("");
          setSmokeLog((items) => [...items, current.status === "succeeded" ? "导出完成，下载地址为对象存储短时授权 URL。" : `导出失败：${current.error}`]);
        }
      } catch (reason) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setAction("");
        setError(getApiError(reason));
      }
    }, 1200);
  }, []);

  async function startExport() {
    if (!selected) return;
    setError("");
    try {
      setAction("投递持久队列");
      setSmokeLog((items) => [...items, "HTTP 请求只负责入库和投递导出任务，立即返回 202。"]);
      const queued = await createExport(selected.id);
      setJob(queued);
      poll(queued.id);
    } catch (reason) {
      setError(getApiError(reason));
      setAction("");
    }
  }

  async function smokeTest() {
    setError("");
    setJob(null);
    setSmokeLog([]);
    const projectName = `贯通测试 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    setCreating(true);
    setAction("创建真实项目");
    try {
      const project = await createProject({ name: projectName, description: "真实项目 + 小 WAV 素材 + 队列转码 ZIP 导出" });
      setSelected(project);
      setProjects((items) => [project, ...items]);
      setSmokeLog((items) => [...items, `项目已写入 Postgres：${project.name}`]);
      const file = createSmallWavFile(1);
      await uploadFile(file);
      await startExport();
    } catch (reason) {
      setError(getApiError(reason));
      setAction("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-white p-7 shadow-card border border-slate-100">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-primary">Real Project · Real Asset · Persistent Export</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">创作项目与导出</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">创建项目和素材元数据会立即写入 Postgres；上传走对象存储预签名；转码和 ZIP 打包由独立长任务执行器消费持久队列。</p>
          </div>
          <button onClick={() => void smokeTest()} disabled={creating || Boolean(action)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-60">
            {creating ? <Loader2 size={17} className="animate-spin" /> : <PlayCircle size={17} />} 一键贯通测试
          </button>
        </div>
      </section>

      {error && <div className="rounded-3xl border border-red-100 bg-red-50 p-5 text-sm text-red-700 flex gap-3"><AlertTriangle size={20} /> {error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-3xl bg-white p-6 shadow-card border border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">项目列表（当前租户）</h3>
            <button onClick={() => void load()} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-primary"><RefreshCw size={18} /></button>
          </div>
          {loading ? <div className="mt-5 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}</div> : (
            <div className="mt-5 space-y-3">
              {projects.length === 0 && <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">暂无项目。使用下方表单创建，或运行一键贯通测试。</div>}
              {projects.map((project) => (
                <button key={project.id} onClick={() => { setSelected(project); setAssetsCount(project._count?.assets ?? 0); setJob(null); }} className={clsx("w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5", selected?.id === project.id ? "border-primary bg-primary/5" : "border-slate-100 bg-slate-50 hover:border-primary/30")}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-900">{project.name}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{project.description || "无描述"}</p>
                    </div>
                    <ArrowRight size={18} className="text-slate-400" />
                  </div>
                  <div className="mt-3 flex gap-2 text-xs">
                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">{project._count?.assets ?? 0} 素材</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-500">{project._count?.exports ?? 0} 导出</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submitProject} className="mt-5 rounded-2xl border border-dashed border-slate-200 p-4">
            <label className="text-sm font-semibold text-slate-700">新建项目</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：秋季新品短片" className="h-11 flex-1 rounded-xl border border-slate-200 px-3 outline-none focus:border-primary" />
              <button disabled={creating} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"><FolderPlus size={17} /> 创建</button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-card border border-slate-100">
          <h3 className="text-lg font-bold">上传与队列导出</h3>
          {!selected ? <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">请选择或创建一个项目。</p> : <>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs text-slate-400">当前项目</p>
              <p className="mt-1 font-bold text-slate-900">{selected.name}</p>
              <p className="mt-1 text-xs text-slate-500">已确认素材：{assetsCount}</p>
            </div>
            <input ref={fileRef} hidden type="file" accept=".wav,.mp4,.png,.jpg,.jpeg,.txt,audio/*,video/*,image/*,text/plain" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadFile(file); e.currentTarget.value = ""; }} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={() => fileRef.current?.click()} disabled={Boolean(action)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold hover:border-primary disabled:opacity-60"><CloudUpload size={17} /> 上传素材</button>
              <button onClick={() => void startExport()} disabled={Boolean(action) || assetsCount === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><PlayCircle size={17} /> 队列导出</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">贯通测试使用浏览器生成的 1 秒 8kHz WAV，体积小，可真实上传并由 ffmpeg 转 MP3 后打包 ZIP。</p>
            {action && <div className="mt-4 flex items-center gap-2 rounded-2xl bg-blue-50 p-4 text-sm text-blue-700"><Loader2 size={17} className="animate-spin" /> {action}</div>}
            {job && <div className="mt-4 rounded-2xl border border-slate-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">任务 {job.status}</p>
                {job.status === "succeeded" && <CheckCircle2 size={19} className="text-emerald-500" />}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={clsx("h-full rounded-full transition-all", job.status === "failed" ? "bg-red-500" : "bg-gradient-to-r from-primary to-accent")} style={{ width: `${job.progress}%` }} /></div>
              {job.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">{job.error}</p>}
              {job.downloadUrl && <a href={job.downloadUrl} className="mt-4 inline-flex rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">下载授权 ZIP（10 分钟有效）</a>}
            </div>}
          </>}
          {smokeLog.length > 0 && <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
            {smokeLog.map((line, index) => <p key={index}>▸ {line}</p>)}
          </div>}
        </section>
      </div>

      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
        <h3 className="font-bold">执行模型与换版续接</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3 text-sm leading-6 text-slate-600">
          <p><strong className="text-slate-900">短操作：</strong>请求线程内完成数据库事务或预签名生成，响应结束即结束。</p>
          <p><strong className="text-slate-900">长任务：</strong>API 只入队；worker 加数据库行锁、更新心跳，ffmpeg 与压缩不占用网页请求。</p>
          <p><strong className="text-slate-900">重启：</strong>worker 启动及每 20 秒扫描，将心跳超过 90 秒的 running 重置为 queued；BullMQ stalled job 也会重投，最多 3 次。</p>
        </div>
        <Link to="/self-check" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">查看队列消费、回调重复和迁移自检 <ArrowRight size={16} /></Link>
      </section>
    </div>
  );
}
