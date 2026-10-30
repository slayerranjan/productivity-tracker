"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import Link from "next/link";
import { clock, clockTime } from "../reports/_team/format";

// Team Attendance (manager view): the LIVE board only: who is working right now.
// History (attendance report, shift breakdown, task productivity) lives under Reports & Analytics.
// Everything comes from GET /team-attendance/*; nothing is calculated from guesses here. The seconds tick in the
// browser between the 30-second refreshes, using the server's own timestamp so the clocks agree.

type LiveStatus = "WORKING" | "TEA" | "LUNCH" | "BIO" | "OTHER_BREAK" | "MEETING" | "CLOCKED_OUT" | "NOT_CLOCKED_IN" | "ON_LEAVE";

type LiveRow = {
  userId: string; name: string; employeeCode: string | null; designation: string | null; teamName: string | null;
  status: LiveStatus; statusStartedAt: string | null; loginAt: string | null; wasLateLogin: boolean; lateByMinutes: number;
  shiftSeconds: number | null; productiveSeconds: number | null; breakSeconds: number | null; meetingSeconds: number | null;
  productiveTargetSeconds: number; breakBudgetSeconds: number;
};
type Live = {
  generatedAt: string; timezone: string; date: string;
  summary: { online: number; clockedOut: number; notClockedIn: number; onLeave: number; present: number; total: number };
  rows: LiveRow[];
};

const STATUS: Record<LiveStatus, { label: string; dot: string; row: string }> = {
  WORKING: { label: "Working", dot: "bg-emerald-500", row: "bg-emerald-50/60" },
  TEA: { label: "Tea break", dot: "bg-amber-500", row: "bg-amber-50" },
  LUNCH: { label: "Lunch break", dot: "bg-amber-500", row: "bg-amber-50" },
  BIO: { label: "Bio break", dot: "bg-amber-500", row: "bg-amber-50" },
  OTHER_BREAK: { label: "Other break", dot: "bg-amber-500", row: "bg-amber-50" },
  MEETING: { label: "In meeting", dot: "bg-indigo-500", row: "bg-indigo-50/70" },
  CLOCKED_OUT: { label: "Clocked out", dot: "bg-slate-400", row: "" },
  NOT_CLOCKED_IN: { label: "Not clocked in", dot: "bg-red-500", row: "bg-red-50/60" },
  ON_LEAVE: { label: "On leave", dot: "bg-sky-500", row: "" },
};

const IS_BREAK = (s: LiveStatus) => s === "TEA" || s === "LUNCH" || s === "BIO" || s === "OTHER_BREAK";

const card = "rounded-2xl bg-white shadow-[var(--shadow-card)]";
const th = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

export default function TeamAttendancePage() {
  const [live, setLive] = useState<Live | null>(null);
  const [liveError, setLiveError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  const loadLive = useCallback(async () => {
    try {
      const data = await apiGet<Live>("/team-attendance/live");
      setLive(data);
      setFetchedAt(Date.now());
      setLiveError("");
    } catch (e) {
      setLiveError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(loadLive, 0);
    const poll = setInterval(loadLive, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [loadLive]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Seconds that passed since the server computed the numbers: added to whatever is still running.
  const drift = Math.max(0, (now - fetchedAt) / 1000);
  const tz = live?.timezone ?? "Asia/Kolkata";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who is working right now. For past days, shift breakdowns and productivity, open{" "}
          <Link href="/dashboard/reports" className="font-medium text-indigo-600 hover:underline">Reports &amp; Analytics</Link>.
        </p>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-end justify-between gap-2 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Live team status</h2>
            {live ? (
              <p className="mt-0.5 text-sm text-slate-500">
                <b className="text-slate-900">{live.summary.online}</b> online now · <b className="text-slate-900">{live.summary.clockedOut}</b> clocked out ·{" "}
                <b className="text-slate-900">{live.summary.notClockedIn}</b> not clocked in today · <b className="text-slate-900">{live.summary.present}</b> present today
                {live.summary.onLeave > 0 && <> · <b className="text-slate-900">{live.summary.onLeave}</b> on leave</>}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-slate-400">Loading…</p>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Refreshes every 30 s{live ? ` · last updated ${clockTime(live.generatedAt, tz)}` : ""}
          </p>
        </div>

        {liveError && (
          <div className="mx-6 mt-4 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>Couldn&apos;t load the live board: {liveError}</span>
            <button onClick={() => void loadLive()} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium hover:bg-red-100">Retry</button>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          {!live && !liveError ? (
            <div className="space-y-2 p-6" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
          ) : live && live.rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No one reports to you yet. People appear here once they are in a team you run or report to you.</p>
          ) : live ? (
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Employee</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>In status</th>
                  <th className={`${th} text-right`}>Shift</th>
                  <th className={`${th} text-right`}>Break used</th>
                  <th className={`${th} text-right`}>Huddle</th>
                  <th className={`${th} text-right`}>Productive</th>
                </tr>
              </thead>
              <tbody>
                {live.rows.map((r) => {
                  const st = STATUS[r.status];
                  const running = r.status === "WORKING" || r.status === "MEETING" || IS_BREAK(r.status);
                  const inStatus = r.statusStartedAt && r.status !== "ON_LEAVE" ? (now - new Date(r.statusStartedAt).getTime()) / 1000 : null;
                  const shiftSec = r.shiftSeconds === null ? null : r.shiftSeconds + (running ? drift : 0);
                  const breakSec = r.breakSeconds === null ? null : r.breakSeconds + (IS_BREAK(r.status) ? drift : 0);
                  const meetSec = r.meetingSeconds === null ? null : r.meetingSeconds + (r.status === "MEETING" ? drift : 0);
                  const prodSec = r.productiveSeconds === null ? null : r.productiveSeconds + (r.status === "WORKING" || r.status === "MEETING" ? drift : 0);
                  const overBudget = breakSec !== null && breakSec > r.breakBudgetSeconds;
                  return (
                    <tr key={r.userId} className={`border-t border-indigo-50 ${st.row}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{r.name}</p>
                        <p className="text-xs text-slate-400">
                          {r.employeeCode ?? "—"}{r.designation ? ` · ${r.designation}` : ""}
                          {r.wasLateLogin && <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">late {r.lateByMinutes}m</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                          <span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{clock(inStatus)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{clock(shiftSec)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${overBudget ? "text-red-600" : "text-slate-900"}`}>
                        {clock(breakSec)}<span className="ml-1 text-xs text-slate-400">/ {clock(r.breakBudgetSeconds)}</span>
                        {breakSec !== null && (overBudget
                          ? <p className="text-[11px] font-medium text-red-600">exceeded by {clock(breakSec - r.breakBudgetSeconds)}</p>
                          : <p className="text-[11px] text-slate-400">{clock(r.breakBudgetSeconds - breakSec)} left</p>)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">{clock(meetSec)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{clock(prodSec)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="h-4" />
      </section>

    </div>
  );
}
