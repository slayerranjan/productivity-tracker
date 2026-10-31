"use client";

import Link from "next/link";

// ---------------------------------------------------------------------------
// MY PERFORMANCE (display). A manager's OWN numbers for a period, read-only. Nothing here is calculated from guesses:
// the figures are the ones Reports and My History already produce, so they always agree with those screens.
// ---------------------------------------------------------------------------

export type Person = {
  daysExpected: number; daysPresent: number; daysOnLeave: number; daysAbsent: number; daysNotTracked: number;
  lateDays: number; lateMinutes: number;
  productiveSeconds: number; breakSeconds: number; meetingSeconds: number; targetSeconds: number; attainment: number;
  tasksCompleted: number; tasksPending: number; taskCompletion: number; tasksTotal: number; taskScore: number;
};
export type Day = {
  date: string; loginAt: string | null; logoutAt: string | null; status: string;
  productiveSeconds: number; breakSeconds: number; meetingSeconds: number; breakCount: number;
  wasLateLogin: boolean; lateByMinutes: number; lateRemark?: string | null; autoClosed: boolean; onLeave: boolean; leaveType: string | null;
  taskTotal: number; taskDone: number; taskPercent: number | null;
};
export type History = { target: number; breakBudget: number; rows: Day[]; summary: { daysWorked: number; totalBreak: number; avgProductive: number; avgTaskScore: number | null } };
export type Standups = { summary: { meetings: number; joined: number; notJoined: number; late: number; averageSeconds: number | null } };

export const hm = (sec: number) => {
  const m = Math.round(Math.max(0, sec) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const band = (v: number) => (v >= 1 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : v >= 0.8 ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-red-50 text-red-600 ring-red-200");
const clockFmt = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso)) : "—");
const dayFmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
        {accent ? <span className={`rounded-lg px-2 py-0.5 ring-1 ${accent}`}>{value}</span> : value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function PerformanceView({ person, history, standups, tz, rangeLabel }: { person: Person; history: History | null; standups: Standups | null; tz: string; rangeLabel: string }) {
  const p = person;
  const days = history?.rows ?? [];
  const counted = p.tasksCompleted + p.tasksPending;
  const avgBreak = history && history.summary.daysWorked > 0 ? history.summary.totalBreak / history.summary.daysWorked : null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card
          label="Productivity"
          value={p.daysExpected > 0 ? pct(p.attainment) : "—"}
          accent={p.daysExpected > 0 ? band(p.attainment) : undefined}
          sub={p.daysExpected > 0 ? "productive hours ÷ expected hours" : "No working days expected in this period"}
        />
        <Card label="Productive time" value={hm(p.productiveSeconds)} sub={`of ${hm(p.targetSeconds)} expected · incl. ${hm(p.meetingSeconds)} in approved meetings`} />
        <Card
          label="Days present"
          value={`${p.daysPresent} of ${p.daysExpected}`}
          sub={`${p.daysOnLeave} on leave · ${p.daysAbsent} absent${p.daysNotTracked > 0 ? ` · ${p.daysNotTracked} not tracked` : ""}`}
        />
        <Card label="Tasks" value={`${p.tasksCompleted} done · ${p.tasksPending} pending`} sub={counted > 0 ? `${pct(p.taskCompletion)} complete · counts approved tasks only` : "No approved tasks in this period"} />
        <Card label="Late arrivals" value={String(p.lateDays)} sub={p.lateDays > 0 ? `${p.lateMinutes} minutes late in total` : "On time every day"} />
        <Card label="Breaks" value={hm(p.breakSeconds)} sub={avgBreak === null ? "No days worked" : `about ${hm(avgBreak)} a day · budget ${hm(history?.breakBudget ?? 0)}`} />
      </div>

      {standups && standups.summary.meetings > 0 && (
        <section className="rounded-2xl bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold text-slate-900">In-person meetings</h2>
          <p className="mt-1 text-sm text-slate-600">
            {standups.summary.meetings} meeting{standups.summary.meetings === 1 ? "" : "s"} · joined {standups.summary.joined} · not joined {standups.summary.notJoined} · late {standups.summary.late}
            {standups.summary.averageSeconds !== null && <> · average {hm(standups.summary.averageSeconds)}</>}
          </p>
          <p className="mt-1 text-xs text-slate-400">Self-reported, all time. Kept separate from your attendance and working hours.</p>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Day by day <span className="font-normal text-slate-400">· {rangeLabel}</span></h2>
          <Link href="/dashboard/history" className="text-xs font-medium text-indigo-600 hover:underline">Open My History</Link>
        </div>
        {days.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No days recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[#F6F7FE] text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">In / out</th>
                  <th className="px-3 py-2.5 text-right">Productive</th>
                  <th className="px-3 py-2.5 text-right">Break</th>
                  <th className="px-3 py-2.5 text-right">Tasks</th>
                  <th className="px-5 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {days.map((d) => {
                  const hit = history ? d.productiveSeconds >= history.target : false;
                  return (
                    <tr key={d.date}>
                      <td className="px-5 py-2.5 font-medium text-slate-900">{dayFmt(d.date)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">{clockFmt(d.loginAt, tz)} – {d.logoutAt ? clockFmt(d.logoutAt, tz) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${hit ? "text-emerald-700" : "text-slate-900"}`}>{hm(d.productiveSeconds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{hm(d.breakSeconds)}<span className="text-xs text-slate-400"> ·{d.breakCount}</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{d.taskTotal === 0 ? "—" : `${d.taskDone}/${d.taskTotal}`}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">
                        {d.onLeave && <span className="mr-2 text-sky-700">on leave</span>}
                        {d.wasLateLogin && <span className="mr-2 text-amber-700" title={d.lateRemark ?? undefined}>late +{d.lateByMinutes}m{d.lateRemark ? `: ${d.lateRemark}` : ""}</span>}
                        {d.autoClosed && <span className="text-slate-400">auto-closed</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
