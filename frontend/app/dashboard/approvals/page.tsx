// ===========================================================================
// APPROVALS — the manager's queue
//
// Two queues, in the order a manager works them: what needs agreeing to
// before anyone starts, and what needs grading now it's finished.
//
// Grading is three buttons, not a form. A manager will do this twenty times
// a day and every extra click is a reason not to bother.
// ===========================================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { useMe } from "../layout";

const API = API_BASE;

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${
        typeof window === "undefined" ? "" : localStorage.getItem("token") ?? ""
      }`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "That didn't work");
  return data as T;
}

type Task = {
  id: string;
  title: string;
  description: string | null;
  weight: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  approvalStatus: string;
  outcome: string | null;
  completionNote: string | null;
  reviewNote: string | null;
  rejectionNote: string | null;
  personName: string | null;
  isCarriedOver: boolean;
  createdAt: string;
};

type Queue = {
  teamSize: number;
  members: { id: string; name: string; employeeCode: string | null }[];
  proposals: Task[];
  toReview: Task[];
  recent: Task[];
};

const WEIGHTS = [
  { value: "LOW", label: "Low", points: 1 },
  { value: "MEDIUM", label: "Medium", points: 2 },
  { value: "HIGH", label: "High", points: 3 },
  { value: "CRITICAL", label: "Critical", points: 5 },
];

const WEIGHT_CHIP: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-sky-50 text-sky-700",
  HIGH: "bg-amber-50 text-amber-700",
  CRITICAL: "bg-rose-50 text-rose-700",
};

const OUTCOMES = [
  { value: "COMPLETED", label: "Completed", cls: "border-emerald-300 text-emerald-700 hover:bg-emerald-50" },
  { value: "PARTIALLY_COMPLETED", label: "Partially", cls: "border-amber-300 text-amber-700 hover:bg-amber-50" },
  { value: "FAILED", label: "Not done", cls: "border-rose-300 text-rose-700 hover:bg-rose-50" },
];

const OUTCOME_CHIP: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: "completed", cls: "bg-emerald-50 text-emerald-700" },
  PARTIALLY_COMPLETED: { label: "partially done", cls: "bg-amber-50 text-amber-700" },
  FAILED: { label: "not done", cls: "bg-rose-50 text-rose-700" },
};

// The endpoint sends the person under several keys and the screen was reading
// one it never sends, so every row showed a blank name. Reading all of them
// means a rename on either side cannot silently empty this column again.
type RowLike = {
  personName?: string | null;
  name?: string | null;
  who?: string | null;
  employee?: string | null;
  employeeCode?: string | null;
  date?: string | null;
};

function dayLabel(iso?: string | null): string {
  if (!iso) return "";
  const today = new Date();
  const d = new Date(iso + "T00:00:00");
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - d.getTime()) / 86400000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  // Past two days an actual date is more useful than "day before yesterday",
  // which stops meaning anything once you are chasing week-old work.
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function personLabel(t: RowLike): string {
  const who = t.personName || t.name || t.who || t.employee || "Unknown";
  const code = t.employeeCode ? ` (${t.employeeCode})` : "";
  const when = dayLabel(t.date);
  return when ? `${who}${code} · ${when}` : `${who}${code}`;
}
export default function ApprovalsPage() {
  const me = useMe();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("MEDIUM");

  // Person is filtered here in the browser - the queue is already loaded.
  // Dates go back to the server, because older days are not in the default
  // response at all.
  const [person, setPerson] = useState<string>("");
  const [preset, setPreset] = useState<string>("default");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const nameOf = (t: RowLike) =>
    t.personName || t.name || t.who || t.employee || "Unknown";

  // Deliberately NOT cast to RowLike - the rendered rows need every field the
  // task actually has. RowLike is only the shape nameOf reads.
  const allProposals = queue?.proposals ?? [];

  const peopleCounts: [string, number][] = Array.from(
    allProposals.reduce((map, t) => {
      const key = nameOf(t as RowLike);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const visibleProposals = person
    ? allProposals.filter((t) => nameOf(t as RowLike) === person)
    : allProposals;

  // Re-fetch when the date filter changes. Separate from the main load so the
  // default view - today plus anything still pending - is untouched.
  useEffect(() => {
    if (preset === "default") return;

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    let from = "";
    let to = "";

    if (preset === "yesterday") {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      from = iso(d);
      to = iso(d);
    } else if (preset === "week") {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      from = iso(d);
      to = iso(today);
    } else if (preset === "custom") {
      // Wait until both ends are chosen, otherwise every keystroke queries.
      if (!customFrom || !customTo) return;
      from = customFrom;
      to = customTo;
    }

    let cancelled = false;
    (async () => {
      try {
        const next = await call<Queue>(
          `/tasks/review/queue?from=${from}&to=${to}`
        );
        if (!cancelled) setQueue(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    try {
      setQueue(await call<Queue>("/tasks/review/queue"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue");
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 30000);
    return () => clearInterval(poll);
  }, [load]);

  async function run(fn: () => Promise<Queue>) {
    setBusy(true);
    setError("");
    try {
      setQueue(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  const allowed = ["MANAGER", "HR", "ADMIN"].includes(me?.role ?? "");

  if (me && !allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          Approvals are for managers.
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Approvals
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Agree the work before it starts, grade it once it's done.
          {queue ? ` ${queue.teamSize} people in your teams.` : ""}
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* --- assign ------------------------------------------------------- */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Assign to…</option>
            {queue?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing"
            className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-900"
          />

          <select
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {WEIGHTS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label} · {w.points}pt
              </option>
            ))}
          </select>

          <button
            disabled={busy || !assignTo || !title.trim()}
            onClick={() =>
              run(async () => {
                const next = await call<Queue>("/tasks/review/assign", "POST", {
                  userId: assignTo,
                  title,
                  weight,
                });
                setTitle("");
                return next;
              })
            }
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            Assign
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Work you assign is approved already — you've agreed to it by assigning it.
        </p>
      </section>

      {/* --- who and when ------------------------------------------------ */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPerson("")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              person === ""
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Everyone ({allProposals.length})
          </button>

          {peopleCounts.map(([who, count]) => (
            <button
              key={who}
              onClick={() => setPerson(person === who ? "" : who)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                person === who
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {who} ({count})
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {[
            { key: "default", label: "Today + pending" },
            { key: "yesterday", label: "Yesterday" },
            { key: "week", label: "Last 7 days" },
            { key: "custom", label: "Custom dates" },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => setPreset(o.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                preset === o.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}

          {preset === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
              />
            </>
          )}
        </div>
      </section>
      {/* --- proposals ---------------------------------------------------- */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-medium text-slate-900">
            Waiting for your approval ({visibleProposals.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Until you approve these, they don't count for anyone.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {queue?.proposals.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">
              Nothing waiting.
            </li>
          )}

          {visibleProposals.map((t) => (
            <li key={t.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{t.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {personLabel(t as RowLike)}
                    {t.isCarriedOver && " · carried over"}
                  </p>
                  {t.description && (
                    <p className="mt-1 text-xs text-slate-500">{t.description}</p>
                  )}
                </div>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    WEIGHT_CHIP[t.weight]
                  }`}
                >
                  {t.weight.toLowerCase()}
                </span>

                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        call<Queue>(`/tasks/review/${t.id}/approve`, "POST", {
                          approve: true,
                        })
                      )
                    }
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setRejecting(rejecting === t.id ? null : t.id);
                      setReason("");
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-40"
                  >
                    Send back
                  </button>
                </div>
              </div>

              {rejecting === t.id && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                    placeholder="Why are you sending it back? They'll see this."
                    className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  />
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      run(async () => {
                        const next = await call<Queue>(
                          `/tasks/review/${t.id}/approve`,
                          "POST",
                          { approve: false, rejectionNote: reason }
                        );
                        setRejecting(null);
                        setReason("");
                        return next;
                      })
                    }
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-40"
                  >
                    Send back
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* --- to grade ------------------------------------------------------ */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-medium text-slate-900">
            Finished, waiting for your verdict ({queue?.toReview.length ?? 0})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Until you grade these they score full marks.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {queue?.toReview.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">
              Nothing to grade.
            </li>
          )}

          {queue?.toReview.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{personLabel(t as RowLike)}</p>
                {t.completionNote && (
                  <p className="mt-1 text-xs text-slate-500">
                    Their note: {t.completionNote}
                  </p>
                )}
              </div>

              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  WEIGHT_CHIP[t.weight]
                }`}
              >
                {t.weight.toLowerCase()}
              </span>

              <div className="flex shrink-0 gap-2">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        call<Queue>(`/tasks/review/${t.id}/outcome`, "POST", {
                          outcome: o.value,
                        })
                      )
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${o.cls}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* --- recent -------------------------------------------------------- */}
      {queue && queue.recent.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-medium text-slate-900">Recently graded</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {queue.recent.map((t) => {
              const grade = t.outcome ? OUTCOME_CHIP[t.outcome] : null;
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    {t.title}
                    <span className="ml-2 text-xs text-slate-400">{personLabel(t as RowLike)}</span>
                  </span>
                  {grade && (
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${grade.cls}`}
                    >
                      {grade.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}