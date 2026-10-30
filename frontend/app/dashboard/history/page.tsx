"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type Row = {
  date: string;
  loginAt: string | null;
  logoutAt: string | null;
  status: string;
  productiveSeconds: number;
  breakSeconds: number;
  meetingSeconds: number;
  breakCount: number;
  meetingCount: number;
  wasLateLogin: boolean;
  lateByMinutes: number;
  autoClosed: boolean;
  onLeave: boolean;
  leaveType: string | null;
  taskTotal: number;
  taskDone: number;
  taskPercent: number | null;
};

type Data = {
  from: string;
  to: string;
  target: number;
  breakBudget: number;
  rows: Row[];
  summary: {
    daysWorked: number;
    daysOnLeave: number;
    daysLate: number;
    totalProductive: number;
    avgProductive: number;
    totalBreak: number;
    totalMeeting: number;
    avgTaskScore: number | null;
  };
};

function hm(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function HistoryPage() {
  const [data, setData] = useState<Data | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Data>(`/tracker/history?from=${from}&to=${to}`));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // CSV is built in the browser from data already on screen — no extra
  // endpoint, and what you export is exactly what you can see.
  function exportCsv() {
    if (!data) return;

    const headers = [
      "Date",
      "Clock in",
      "Clock out",
      "Productive",
      "Break",
      "Meetings",
      "Breaks taken",
      "Late by (min)",
      "Auto closed",
      "On leave",
      "Tasks done",
      "Task score %",
    ];

    const lines = data.rows.map((r) =>
      [
        r.date,
        r.loginAt ? new Date(r.loginAt).toLocaleTimeString("en-IN") : "",
        r.logoutAt ? new Date(r.logoutAt).toLocaleTimeString("en-IN") : "",
        hm(r.productiveSeconds),
        hm(r.breakSeconds),
        hm(r.meetingSeconds),
        r.breakCount,
        r.wasLateLogin ? r.lateByMinutes : 0,
        r.autoClosed ? "yes" : "no",
        r.onLeave ? r.leaveType ?? "yes" : "no",
        `${r.taskDone}/${r.taskTotal}`,
        r.taskPercent ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = [headers.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );

    const a = document.createElement("a");
    a.href = url;
    a.download = `my-history-${data.from}-to-${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Your record</p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-0.5">
            My history
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-indigo-200 px-3 py-2 text-sm text-slate-900"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-indigo-200 px-3 py-2 text-sm text-slate-900"
          />
          <button
            onClick={exportCsv}
            disabled={!data || data.rows.length === 0}
            className="rounded-xl border border-indigo-200 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-indigo-50/60 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            {[
              ["Days worked", String(data.summary.daysWorked)],
              ["Avg productive", hm(data.summary.avgProductive)],
              ["Total productive", hm(data.summary.totalProductive)],
              ["Days late", String(data.summary.daysLate)],
              [
                "Avg task score",
                data.summary.avgTaskScore === null
                  ? "—"
                  : `${data.summary.avgTaskScore}%`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl bg-white shadow-[var(--shadow-card)] px-4 py-3"
              >
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-indigo-50 bg-slate-50/60">
                  <th className="text-left px-5 py-3 font-medium text-slate-500">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500">
                    In / out
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-slate-500">
                    Productive
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-slate-500">
                    Break
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-slate-500">
                    Meetings
                  </th>
                  <th className="text-right px-5 py-3 font-medium text-slate-500">
                    Tasks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-50">
                {data.rows.map((r) => {
                  const hitTarget = r.productiveSeconds >= data.target;
                  const overBreak = r.breakSeconds > data.breakBudget;

                  return (
                    <tr key={r.date} className="hover:bg-indigo-50/60/60">
                      <td className="px-5 py-3">
                        <p className="text-slate-900 font-medium">
                          {new Date(`${r.date}T00:00:00Z`).toLocaleDateString(
                            "en-IN",
                            { day: "numeric", month: "short", weekday: "short" }
                          )}
                        </p>
                        <div className="flex gap-1.5 mt-0.5">
                          {r.onLeave && (
                            <span className="text-xs text-sky-600">
                              on leave
                            </span>
                          )}
                          {r.autoClosed && (
                            <span className="text-xs text-slate-400">
                              auto-closed
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">
                        {r.loginAt
                          ? new Date(r.loginAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                        {" – "}
                        {r.logoutAt
                          ? new Date(r.logoutAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                        {r.wasLateLogin && (
                          <span className="ml-1.5 text-xs text-amber-600">
                            +{r.lateByMinutes}m
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-medium ${
                          hitTarget ? "text-emerald-700" : "text-slate-900"
                        }`}
                      >
                        {hm(r.productiveSeconds)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          overBreak ? "text-red-600 font-medium" : "text-slate-600"
                        }`}
                      >
                        {hm(r.breakSeconds)}
                        <span className="text-xs text-slate-400">
                          {" "}
                          ·{r.breakCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {hm(r.meetingSeconds)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                        {r.taskTotal === 0 ? (
                          "—"
                        ) : (
                          <>
                            {r.taskDone}/{r.taskTotal}
                            <span className="ml-1.5 text-xs text-slate-400">
                              {r.taskPercent}%
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {data.rows.length === 0 && (
              <p className="px-6 py-10 text-center text-sm text-slate-400">
                No days recorded in this range.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}