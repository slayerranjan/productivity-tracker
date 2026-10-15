"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useMe } from "../layout";

type Row = {
  userId: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  teamName: string;
  status:
    | "WORKING"
    | "ON_BREAK"
    | "IN_MEETING"
    | "DONE"
    | "NOT_CLOCKED_IN"
    | "ON_LEAVE";
  pendingInvite: boolean;
  breakType: string | null;
  loginAt: string | null;
  wasLateLogin: boolean;
  lateByMinutes: number;
  productiveSeconds: number;
  breakSeconds: number;
  meetingSeconds: number;
  productiveTarget: number;
  breakBudget: number;
};

type Alert = {
  id: string;
  userId: string;
  name: string;
  alertType: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
};

const SEVERITY: Record<Alert["severity"], string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
  WARNING: "border-amber-200 bg-amber-50 text-amber-800",
  INFO: "border-sky-200 bg-sky-50 text-sky-800",
};

const STATUS: Record<
  Row["status"],
  { label: string; dot: string; chip: string }
> = {
  WORKING: {
    label: "Working",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700",
  },
  ON_BREAK: {
    label: "On break",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700",
  },
  IN_MEETING: {
    label: "In a meeting",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700",
  },
  DONE: {
    label: "Day complete",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600",
  },
  NOT_CLOCKED_IN: {
    label: "Not clocked in",
    dot: "bg-slate-300",
    chip: "bg-slate-50 text-slate-500",
  },
  ON_LEAVE: {
    label: "On leave",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700",
  },
};

const MEETING_TYPES = [
  { value: "TEAM", label: "Team meeting" },
  { value: "ONE_ON_ONE", label: "One on one" },
  { value: "CLIENT", label: "Client call" },
  { value: "TRAINING", label: "Training" },
  { value: "INTERVIEW", label: "Interview" },
  { value: "OTHER", label: "Other" },
];

function hm(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function TeamPage() {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [meetingType, setMeetingType] = useState("TEAM");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    try {
      const [team, alertList] = await Promise.all([
        apiGet<Row[]>("/tracker/team"),
        apiGet<Alert[]>("/tracker/alerts"),
      ]);
      setRows(team);
      setAlerts(alertList);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the team");
    }
  }, []);

  async function ack(id: string) {
    try {
      setAlerts(await apiPost<Alert[]>(`/tracker/alerts/${id}/ack`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear that");
    }
  }


  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, [load]);

  function toggle(userId: string) {
    setSelected((s) =>
      s.includes(userId) ? s.filter((x) => x !== userId) : [...s, userId]
    );
  }

  async function sendInvite() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiPost<{
        invited: string[];
        skipped: { userId: string; reason: string }[];
      }>("/tracker/meetings/invite", {
        employeeIds: selected,
        meetingType,
        title: title.trim() || undefined,
      });

      const parts = [`Invited ${res.invited.length}`];
      if (res.skipped.length) {
        const names = res.skipped
          .map((s) => {
            const row = rows.find((r) => r.userId === s.userId);
            return `${row?.name ?? "Someone"} (${s.reason.toLowerCase()})`;
          })
          .join(", ");
        parts.push(`skipped ${names}`);
      }
      setNotice(parts.join(" · "));
      setSelected([]);
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invite");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const invitable = selected.filter((id) => {
    const r = rows.find((x) => x.userId === id);
    return r && (r.status === "WORKING" || r.status === "ON_BREAK");
  });

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Live · refreshes every 15s</p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-0.5">
            Your team today
          </h1>
        </div>
        <p className="text-sm text-slate-400">{rows.length} people</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {(
          [
            "WORKING",
            "ON_BREAK",
            "IN_MEETING",
            "NOT_CLOCKED_IN",
            "ON_LEAVE",
          ] as Row["status"][]
        ).map((key) => (
          <div
            key={key}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS[key].dot}`} />
              <p className="text-xs text-slate-500">{STATUS[key].label}</p>
            </div>
            <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {counts[key] ?? 0}
            </p>
          </div>
        ))}
      </div>

            {alerts.length > 0 && (
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-900">
              Needs attention
            </h2>
            <span className="text-xs text-slate-400">
              {alerts.length} today
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="px-5 py-3 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${SEVERITY[a.severity]}`}
                  >
                    {a.alertType.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <p className="text-sm text-slate-700 truncate">
                    <span className="font-medium text-slate-900">{a.name}</span>
                    {" — "}
                    {a.message}
                  </p>
                </div>
                <button
                  onClick={() => ack(a.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-slate-900"
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-sm font-medium text-indigo-900 mb-3">
            {selected.length} selected
            {invitable.length !== selected.length && (
              <span className="font-normal text-indigo-600">
                {" "}
                · only {invitable.length} are clocked in and can be invited
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value)}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {MEETING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's it about? (optional)"
              className="flex-1 min-w-48 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
            <button
              disabled={busy || invitable.length === 0}
              onClick={sendInvite}
              className="rounded-lg bg-indigo-600 text-white text-sm font-medium px-5 py-2 hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send invite"}
            </button>
            <button
              onClick={() => setSelected([])}
              className="text-sm text-indigo-700 px-2 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="w-10 px-4 py-3" />
              <th className="text-left px-2 py-3 font-medium text-slate-500">
                Person
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-500">
                Status
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-500">
                In at
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const s = STATUS[r.status];
              const overBreak = r.breakSeconds > r.breakBudget;
              const pct = Math.min(
                100,
                (r.productiveSeconds / r.productiveTarget) * 100
              );

              return (
                <tr
                  key={r.userId}
                  className={
                    r.pendingInvite ? "bg-violet-50/60" : "hover:bg-slate-50/60"
                  }
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.userId)}
                      onChange={() => toggle(r.userId)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-2 py-3">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-400">
                      {r.employeeCode ?? "—"}
                      {r.designation ? ` · ${r.designation}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.chip}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.label}
                      {r.breakType ? ` · ${r.breakType.toLowerCase()}` : ""}
                    </span>
                    {r.pendingInvite && (
                      <span className="ml-2 text-xs text-violet-600">
                        invite pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">
                    {r.loginAt
                      ? new Date(r.loginAt).toLocaleTimeString("en-IN", {
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
                  <td className="px-4 py-3 text-right">
                    <p className="text-slate-900 font-medium tabular-nums">
                      {hm(r.productiveSeconds)}
                    </p>
                    <div className="mt-1 h-1 w-20 ml-auto rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      overBreak ? "text-red-600 font-medium" : "text-slate-600"
                    }`}
                  >
                    {hm(r.breakSeconds)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                    {hm(r.meetingSeconds)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No team members yet.
          </p>
        )}
      </div>
    </div>
  );
}