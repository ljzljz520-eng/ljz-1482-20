import { ReactNode } from "react";

/** 缺后端/失败态统一面板：明确展示不可用原因，杜绝无提示降级假数据 */
export default function StatePanel({
  tone = "error",
  title,
  reason,
  action,
}: {
  tone?: "error" | "info" | "warning";
  title: string;
  reason: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    error: "border-rose-200 bg-rose-50/70 text-rose-800",
    info: "border-slate-200 bg-white text-slate-700",
    warning: "border-amber-200 bg-amber-50/70 text-amber-800",
  } as const;
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg">{tone === "error" ? "⛔" : tone === "warning" ? "⚠️" : "ℹ️"}</span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <div className="text-[13px] leading-relaxed opacity-90">{reason}</div>
          {action && <div className="pt-1">{action}</div>}
        </div>
      </div>
    </div>
  );
}
