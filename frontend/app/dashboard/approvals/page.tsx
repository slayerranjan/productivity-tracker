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
import { addDaysIso, isoDaysAgo, todayIso } from "@/lib/time";
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
  status?: string | null;
  approvalStatus?: string | null;
  outcome?: string | null;
  id?: string;
  title?: string;
};

function dayLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  const days = Math.round(
    (new Date(todayIso() + "T00:00:00Z").getTime() - d.getTime()) / 86400000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  // Past two days an actual date is more useful than "day before yesterday",
  // which stops meaning anything once you are chasing week-old work.
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
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
  const [tab, setTab] = useState<string>("waiting");

  // Every task the manager can see, split by where it actually is. The
  // database already carries all of these - the screen simply never showed
  // them, so approved work looked like it had disappeared.
  // The endpoint sends ll; the local Queue type never declared it.
  const everything = ((queue as unknown as { all?: RowLike[] })?.all ?? []) as RowLike[];

  const bucket = (key: string) =>
    everything.filter((t) => {
      const a = String(t.approvalStatus ?? "");
      const s = String(t.status ?? "");
      if (a !== "APPROVED") return false;
      if (key === "todo") return s === "PENDING";
      if (key === "inProgress") return s === "IN_PROGRESS";
      if (key === "completed") return s === "COMPLETED";
      if (key === "graded") return Boolean(t.outcome);
      return false;
    });

  const nameOf = (t: RowLike) =>
    t.personName || t.name || t.who || t.employee || "Unknown";

  // Deliberately NOT cast to RowLike - the rendered rows need every field the
  // task actually has. RowLike is only the shape nameOf reads.
  const allProposals = queue?.proposals ?? [];

  const peopleCounts: [string, number][] = Array.from(
    everything.reduce((map, t) => {
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

    let from = "";
    let to = "";

    if (preset === "yesterday") {
      from = isoDaysAgo(1);
      to = from;
    } else if (preset === "week") {
      from = isoDaysAgo(6);
      to = todayIso();
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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Team tasks</h1>
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
      {/* --- who, what state, when --------------------------------------- */}
      <section className="rounded-2xl rounded-b-none border border-b-0 border-slate-200 bg-white">
        {/* people */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {[{ who: "", count: everything.length }, ...peopleCounts.map(([who, count]) => ({ who, count }))].map(
            (c) => {
              const label = c.who || "Everyone";
              const active = person === c.who;
              const initials = label
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <button
                  key={label}
                  onClick={() => setPerson(c.who)}
                  className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm transition ${
                    active
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                      active ? "bg-indigo-600" : "bg-slate-400"
                    }`}
                  >
                    {initials}
                  </span>
                  <span className="font-medium">{label}</span>
                  <span className={active ? "text-indigo-400" : "text-slate-400"}>
                    {c.count}
                  </span>
                </button>
              );
            }
          )}
        </div>

        {/* state + when */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4">
          <div className="flex flex-wrap items-center gap-6">
            {[
              { key: "waiting", label: "Needs approval", n: allProposals.length },
              { key: "todo", label: "To do", n: bucket("todo").length },
              { key: "inProgress", label: "In progress", n: bucket("inProgress").length },
              { key: "completed", label: "Completed", n: bucket("completed").length },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setTab(o.key)}
                className={`-mb-px flex items-center gap-2 border-b-2 py-3 text-sm transition ${
                  tab === o.key
                    ? "border-indigo-600 font-semibold text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {o.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                    tab === o.key
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {o.n}
                </span>
              </button>
            ))}
          </div>

          <div className="relative py-2">
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="default">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 days</option>
              <option value="custom">Custom dates</option>
            </select>
          </div>
        </div>

        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
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
          </div>
        )}
      </section>

      {/* --- who and when ------------------------------------------------ */}
      {/* --- proposals ---------------------------------------------------- */}
      {tab === "waiting" && (
      <section className="overflow-hidden rounded-2xl rounded-t-none border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5">
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
      )}

      {/* --- to grade ------------------------------------------------------ */}
      {/* --- work already approved -------------------------------------- */}
      {["todo", "inProgress"].includes(tab) && (
      <section className="overflow-hidden rounded-2xl rounded-t-none border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <p className="mt-0.5 text-xs text-slate-400">
            What you have already approved, and where it has got to.
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {bucket(tab)
            .filter((t) => !person || nameOf(t) === person)
            .map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900">{t.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{personLabel(t)}</p>
                </div>
                {t.outcome && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {String(t.outcome).toLowerCase().replace("_", " ")}
                  </span>
                )}
              </li>
            ))}

          {bucket(tab).filter((t) => !person || nameOf(t) === person).length === 0 && (
            <li className="px-5 py-6 text-center text-xs text-slate-400">
              Nothing here.
            </li>
          )}
        </ul>
      </section>
      )}

      {tab === "completed" && (
      <section className="overflow-hidden rounded-2xl rounded-t-none border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3.5">
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
      )}

      {/* --- recent -------------------------------------------------------- */}
      {queue && queue.recent.length > 0 && (
        <section className="overflow-hidden rounded-2xl rounded-t-none border border-slate-200 bg-white">
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