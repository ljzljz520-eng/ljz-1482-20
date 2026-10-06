export default function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
      <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, index) => <div key={index} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${82 - index * 12}%` }} />)}
      </div>
    </div>
  );
}
