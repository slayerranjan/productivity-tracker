"use client";

// Two-layer bar: amber is uploaded-but-unreviewed, green is approved. Keeping
// them separate is the point - a joiner who has sent everything still isn't
// done, and HR needs to see the difference at a glance.

export function ProgressBar({
  percent,
  submittedPercent,
}: {
  percent: number;
  submittedPercent?: number;
}) {
  const green = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const amber = Math.max(green, Math.min(100, Math.round(submittedPercent ?? 0)));

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-amber-400 transition-all"
          style={{ width: `${amber}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${
            green === 100 ? "bg-emerald-500" : "bg-emerald-400"
          }`}
          style={{ width: `${green}%` }}
        />
      </div>
      <span
        className={`text-xs font-medium tabular-nums ${
          green === 100 ? "text-emerald-600" : "text-slate-500"
        }`}
      >
        {green}%
      </span>
    </div>
  );
}

type ChecklistItem = {
  requirementId: string;
  label: string;
  isMandatory: boolean;
  status: string;
  fileName?: string | null;
  rejectionReason?: string | null;
  done: boolean;
};

const STATE: Record<string, { dot: string; text: string; label: string }> = {
  APPROVED: { dot: "bg-emerald-500", text: "text-slate-700", label: "Approved" },
  SUBMITTED: { dot: "bg-amber-400", text: "text-slate-700", label: "In review" },
  REJECTED: { dot: "bg-rose-500", text: "text-rose-700", label: "Rejected" },
  REQUESTED: { dot: "bg-slate-300", text: "text-slate-500", label: "Not uploaded" },
  MISSING: { dot: "bg-slate-300", text: "text-slate-500", label: "Not uploaded" },
};

export function Checklist({ items }: { items?: ChecklistItem[] }) {
  const list = items ?? [];
  if (list.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No document requirements configured for this company yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {list.map((item) => {
        const s = STATE[item.status] ?? STATE.MISSING;
        return (
          <li key={item.requirementId} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${s.dot}`} />
            <span className="flex-1">
              <span className={s.text}>{item.label}</span>
              {!item.isMandatory && (
                <span className="ml-1.5 text-xs text-slate-400">(optional)</span>
              )}
              <span className="ml-2 text-xs text-slate-400">{s.label}</span>
              {item.rejectionReason && (
                <span className="block text-xs text-rose-600">
                  Rejected: {item.rejectionReason}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}