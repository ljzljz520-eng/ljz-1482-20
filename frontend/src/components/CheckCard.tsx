import type { CheckResult } from "../api/types";

const STYLE: Record<CheckResult["status"], { dot: string; text: string; bg: string; label: string }> = {
  pass: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50/60 border-emerald-200", label: "通过" },
  fail: { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50/70 border-rose-200", label: "失败" },
  warn: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50/70 border-amber-200", label: "跳过/警告" },
};

export default function CheckCard({ check }: { check: CheckResult }) {
  const s = STYLE[check.status];
  return (
    <div className={`rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${s.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${s.dot} ${check.status === "fail" ? "animate-pulse" : ""}`} />
          <h4 className="text-sm font-semibold text-slate-800">{check.label}</h4>
        </div>
        <span className={`rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium ${s.text}`}>
          {s.label}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{check.detail}</p>
      {check.remediation && (
        <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs leading-relaxed text-slate-500">
          <span className="font-medium text-slate-600">处理建议：</span>
          {check.remediation}
        </p>
      )}
    </div>
  );
}
