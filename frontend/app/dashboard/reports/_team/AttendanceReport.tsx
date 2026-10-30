"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { clockTime, dayLabel, downloadCsv, hmFromHours, hmFromMinutes } from "./format";
import { PRESETS, rangeFor, type Preset } from "./ranges";

// Attendance report: one row per person per day for a date range.
// Data: GET /team-attendance/attendance. Status, hours and lateness come from the same engine that salary and
// Reports use, so the figures here match those screens.

type Row = {
  userId: string; name: string; employeeCode: string | null; teamName: string | null; date: string;
  shiftName: string | null; shiftStart: string | null; shiftEnd: string | null;
  loginAt: string | null; logoutAt: string | null; workedHours: number | null; breakHours: number | null; breakBudgetSeconds: number;
  status: string; statusLabel: string; leaveType: string | null; holidayName: string | null;
  lateMinutes: number | null; earlyDepartureMinutes: number | null; tasksCompleted: number;
};
type Report = {
  generatedAt: string; timezone: string; today: string; from: string; to: string;
  options: { people: { id: string; name: string; code: string | null }[]; teams: { id: string; name: string }[]; shifts: string[] };
  kpis: { employees: number; present: number; halfDay: number; absent: number; attendancePct: number | null; totalWorkedHours: number; avgWorkedHours: number | null };
  rows: Row[];
};

const STATUSES: [string, string][] = [["PRESENT", "Present"], ["HALF_DAY", "Half day"], ["ABSENT", "Absent"], ["LEAVE", "Leave"], ["HOLIDAY", "Holiday"], ["WEEK_OFF", "Week-off"], ["NOT_TRACKED", "Not tracked"]];

const STATUS_STYLE: Record<string, string> = {
  PRESENT: "bg-emerald-50 text-emerald-700", HALF_DAY: "bg-amber-50 text-amber-700", ABSENT: "bg-red-50 text-red-600",
  LEAVE: "bg-sky-50 text-sky-700", HOLIDAY: "bg-violet-50 text-violet-700", WEEK_OFF: "bg-slate-100 text-slate-600", NOT_TRACKED: "bg-slate-100 text-slate-500",
};

const select = "rounded-xl border border-indigo-100 bg-white px-3 py-2 text-sm text-slate-700";
const th = "px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function AttendanceReport() {
  const [preset, setPreset] = useState<Preset>("thismonth");
  const [single, setSingle] = useState("");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [shift, setShift] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const [today, setToday] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The company's "today" comes from the first answer; until then ask for the server default (today).
  const range = useMemo(() => {
    if (preset === "single") return single ? { from: single, to: single } : null;
    if (preset === "custom") return custom.from && custom.to ? custom : null;
    return today ? rangeFor(preset, today) : { from: "", to: "" };
  }, [preset, single, custom, today]);

  const load = useCallback(async () => {
    if (!range) return;
    const qs = new URLSearchParams();
    if (range.from) qs.set("from", range.from);
    if (range.to) qs.set("to", range.to);
    if (userId) qs.set("userId", userId);
    if (teamId) qs.set("teamId", teamId);
    if (shift) qs.set("shift", shift);
    if (status) qs.set("status", status);
    try {
      const data = await apiGet<Report>(`/team-attendance/attendance?${qs.toString()}`);
      setReport(data);
      setToday(data.today);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, userId, teamId, shift, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!report) return [];
    return q ? report.rows.filter((r) => r.name.toLowerCase().includes(q) || (r.employeeCode ?? "").toLowerCase().includes(q)) : report.rows;
  }, [report, search]);

  const shiftText = (r: Row) => (r.shiftName ? `${r.shiftName}${r.shiftStart && r.shiftEnd ? ` (${r.shiftStart}–${r.shiftEnd})` : ""}` : "Not assigned");

  function exportCsv() {
    if (!report) return;
    const tz = report.timezone;
    downloadCsv(
      `attendance-${report.from}_to_${report.to}.csv`,
      ["Employee", "Employee ID", "Team", "Date", "Shift", "Shift start", "Shift end", "Check-in", "Check-out", "Working hours", "Break", "Break over allowance", "Status", "Late arrival", "Early departure", "Tasks completed"],
      rows.map((r) => [r.name, r.employeeCode, r.teamName, r.date, r.shiftName ?? "Not assigned", r.shiftStart, r.shiftEnd, clockTime(r.loginAt, tz), clockTime(r.logoutAt, tz), hmFromHours(r.workedHours), hmFromHours(r.breakHours), r.breakHours !== null && r.breakHours * 3600 > r.breakBudgetSeconds ? hmFromHours(r.breakHours - r.breakBudgetSeconds / 3600) : "", r.statusLabel, hmFromMinutes(r.lateMinutes), hmFromMinutes(r.earlyDepartureMinutes), r.tasksCompleted])
    );
  }

  const k = report?.kpis;
  const tz = report?.timezone ?? "Asia/Kolkata";

  return (
    <div className="space-y-5">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]">
        <select value={preset} onChange={(e) => { setLoading(true); setPreset(e.target.value as Preset); }} className={select} aria-label="Date range">
          {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {preset === "single" && <input type="date" value={single} max={today || undefined} onChange={(e) => { setLoading(true); setSingle(e.target.value); }} className={select} aria-label="Date" />}
        {preset === "custom" && (
          <>
            <input type="date" value={custom.from} max={today || undefined} onChange={(e) => { setLoading(true); setCustom((c) => ({ ...c, from: e.target.value })); }} className={select} aria-label="From" />
            <span className="text-sm text-slate-400">to</span>
            <input type="date" value={custom.to} max={today || undefined} onChange={(e) => { setLoading(true); setCustom((c) => ({ ...c, to: e.target.value })); }} className={select} aria-label="To" />
          </>
        )}
        <select value={userId} onChange={(e) => { setLoading(true); setUserId(e.target.value); }} className={select} aria-label="Employee">
          <option value="">All employees</option>
          {report?.options.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""}</option>)}
        </select>
        <select value={teamId} onChange={(e) => { setLoading(true); setTeamId(e.target.value); }} className={select} aria-label="Team">
          <option value="">All teams</option>
          {report?.options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={shift} onChange={(e) => { setLoading(true); setShift(e.target.value); }} className={select} aria-label="Shift" disabled={!report || report.options.shifts.length === 0} title={report && report.options.shifts.length === 0 ? "No shifts are set up yet" : undefined}>
          <option value="">{report && report.options.shifts.length === 0 ? "No shifts set up" : "All shifts"}</option>
          {report?.options.shifts.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }} className={select} aria-label="Attendance status">
          <option value="">Any status</option>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID" className={`${select} min-w-[11rem]`} aria-label="Search" />
        <button onClick={exportCsv} disabled={!report || rows.length === 0} className="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Export CSV</button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Couldn&apos;t load the attendance report: {error}</span>
          <button onClick={() => void load()} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium hover:bg-red-100">Retry</button>
        </div>
      )}

      {/* KPI cards */}
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7 ${loading ? "opacity-60" : ""}`}>
        <Kpi label="Employees" value={k ? String(k.employees) : "—"} />
        <Kpi label="Present" value={k ? String(k.present) : "—"} sub="days" />
        <Kpi label="Absent" value={k ? String(k.absent) : "—"} sub="days" />
        <Kpi label="Half day" value={k ? String(k.halfDay) : "—"} sub="days" />
        <Kpi label="Attendance" value={k?.attendancePct == null ? "—" : `${k.attendancePct}%`} sub="present + ½ half ÷ working days" />
        <Kpi label="Total hours" value={k ? hmFromHours(k.totalWorkedHours) : "—"} />
        <Kpi label="Avg / day worked" value={k ? hmFromHours(k.avgWorkedHours) : "—"} />
      </div>

      {/* table */}
      <section className="rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto">
          {loading && !report ? (
            <div className="space-y-2 p-6" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-10" />)}</div>
          ) : report && rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">No attendance rows match these filters.</p>
          ) : report ? (
            <table className={`w-full min-w-[1100px] text-sm ${loading ? "opacity-60" : ""}`}>
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Employee</th>
                  <th className={th}>Team</th>
                  <th className={th}>Date</th>
                  <th className={th}>Shift</th>
                  <th className={th}>Check-in</th>
                  <th className={th}>Check-out</th>
                  <th className={`${th} text-right`}>Working</th>
                  <th className={`${th} text-right`}>Break</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Late</th>
                  <th className={`${th} text-right`}>Early exit</th>
                  <th className={`${th} text-right`}>Tasks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.userId}|${r.date}`} className="border-t border-indigo-50">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-400">{r.employeeCode ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.teamName ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{dayLabel(r.date)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{shiftText(r)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-900">{clockTime(r.loginAt, tz)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-900">{clockTime(r.logoutAt, tz)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{hmFromHours(r.workedHours)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.breakHours !== null && r.breakHours * 3600 > r.breakBudgetSeconds + 30 ? (
                        <span className="font-medium text-red-600">{hmFromHours(r.breakHours)}<span className="block text-[11px]">over by {hmFromHours(r.breakHours - r.breakBudgetSeconds / 3600)}</span></span>
                      ) : (
                        <span className="text-slate-600">{hmFromHours(r.breakHours)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {r.statusLabel}{r.status === "LEAVE" && r.leaveType ? ` · ${r.leaveType.toLowerCase()}` : ""}{r.status === "HOLIDAY" && r.holidayName ? ` · ${r.holidayName}` : ""}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.lateMinutes ? "text-red-600" : "text-slate-400"}`}>{r.loginAt ? (r.lateMinutes ? hmFromMinutes(r.lateMinutes) : "On time") : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{hmFromMinutes(r.earlyDepartureMinutes)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.tasksCompleted || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <p className="px-6 pb-5 pt-3 text-xs text-slate-400">
          {report ? `${dayLabel(report.from)} – ${dayLabel(report.to)} · ${rows.length} row${rows.length === 1 ? "" : "s"} · times in ${tz}. ` : ""}
          Shift, late and early-exit show a dash where no shift is assigned. Tasks counts approved, completed tasks planned for that day. A dash means nothing was recorded, not zero.
        </p>
      </section>
    </div>
  );
}
