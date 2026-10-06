import clsx from "clsx";
import type { CheckStatus } from "@/types/api";

const labels: Record<CheckStatus, string> = {
  pass: "通过",
  warn: "警告",
  fail: "失败",
  skipped: "跳过"
};

const styles: Record<CheckStatus, string> = {
  pass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  fail: "bg-red-50 text-red-700 ring-red-200",
  skipped: "bg-slate-100 text-slate-500 ring-slate-200"
};

export default function StatusBadge({ status }: { status: CheckStatus }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1", styles[status])}>{labels[status]}</span>;
}
