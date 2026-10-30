// ===========================================================================
// TICKETS
//
// List on the left, conversation on the right. The list is the index; the
// thread is where the work happens, so it gets the space.
//
// An attendance correction shows the requested times in a panel of their own
// with Approve and apply — because that button doesn't just close a ticket,
// it rewrites a recorded work session.
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

// --- types -----------------------------------------------------------------

type TicketRow = {
  id: string;
  reference: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  dueAt: string | null;
  isOverdue: boolean;
  correctionDate: string | null;
  appliedAt: string | null;
  createdAt: string;
  raisedBy: string;
  raisedById: string;
  assignedTo: string | null;
  messageCount: number;
};

type Message = {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: string;
  authorId: string;
};

type TicketDetail = {
  id: string;
  reference: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string;
  dueAt: string | null;
  resolvedAt: string | null;
  correctionDate: string | null;
  requestedLoginAt: string | null;
  requestedLogoutAt: string | null;
  appliedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  raisedBy: { id: string; firstName: string; lastName: string; employeeCode: string | null };
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  messages: Message[];
  permissions: {
    canReply: boolean;
    canAddInternalNote: boolean;
    canChangeStatus: boolean;
    canApplyCorrection: boolean;
  };
};

const CATEGORY_LABELS: Record<string, string> = {
  HR_QUERY: "HR query",
  TECH_ISSUE: "Tech issue",
  ADMIN_REQUEST: "Admin request",
  ATTENDANCE_CORRECTION: "Attendance correction",
};

const STATUS_CHIP: Record<string, string> = {
  OPEN: "bg-sky-50 text-sky-700 ring-sky-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-[#EEF0FD] text-slate-600 ring-slate-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
};

const PRIORITY_CHIP: Record<string, string> = {
  LOW: "text-slate-400",
  NORMAL: "text-slate-500",
  HIGH: "text-amber-600",
  URGENT: "text-rose-600",
};

function dueLabel(dueAt: string | null, isOverdue: boolean): string {
  if (!dueAt) return "";
  const diff = new Date(dueAt).getTime() - Date.now();
  const hours = Math.round(Math.abs(diff) / 3600_000);
  if (isOverdue) return hours < 1 ? "just overdue" : `${hours}h overdue`;
  if (hours < 1) return "due within the hour";
  if (hours < 48) return `due in ${hours}h`;
  return `due in ${Math.round(hours / 24)}d`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIso() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// ===========================================================================

export default function TicketsPage() {
  const me = useMe();
  const isStaff = ["MANAGER", "HR", "ADMIN"].includes(me?.role ?? "");

  const [scope, setScope] = useState<"mine" | "assigned" | "all">("mine");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [counts, setCounts] = useState({ mine: 0, assigned: 0, overdue: 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, c] = await Promise.all([
        call<{ tickets: TicketRow[] }>(`/tickets?scope=${scope}`),
        call<{ mine: number; assigned: number; overdue: number }>("/tickets/counts"),
      ]);
      setRows(list.tickets);
      setCounts(c);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tickets");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tickets move when other people act on them, so the list refreshes on a
  // slow poll. Thirty seconds — a help desk doesn't need one-second latency.
  useEffect(() => {
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const TABS: { key: typeof scope; label: string; badge?: number }[] = [
    { key: "mine", label: "Raised by me", badge: counts.mine },
    { key: "assigned", label: "Assigned to me", badge: counts.assigned },
    ...(isStaff ? [{ key: "all" as const, label: "All" }] : []),
  ];

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tickets</h1>
          <p className="mt-1 text-sm text-slate-500">
            HR questions, tech issues, admin requests — and the only way to correct a
            recorded work session.
          </p>
        </div>
        <button
          onClick={() => setRaising(true)}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          + Raise a ticket
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-indigo-100 bg-[#F6F7FE] p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setScope(t.key);
                setOpenId(null);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                scope === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="ml-2 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {isStaff && counts.overdue > 0 && (
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
            {counts.overdue} past its response target
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        {/* --- list ------------------------------------------------------- */}
        <div className="space-y-2">
          {rows.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpenId(t.id)}
              className={`w-full rounded-xl border p-4 text-left transition ${
                openId === t.id
                  ? "border-indigo-600 bg-white shadow-sm"
                  : "border-indigo-100 bg-white hover:border-indigo-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-400">{t.reference}</span>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${
                    STATUS_CHIP[t.status] ?? "bg-[#F6F7FE] text-slate-600 ring-slate-200"
                  }`}
                >
                  {t.status.toLowerCase().replace(/_/g, " ")}
                </span>
              </div>

              <p className="mt-1.5 text-sm font-medium text-slate-900 line-clamp-2">
                {t.subject}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {CATEGORY_LABELS[t.category] ?? t.category} · {t.raisedBy}
                {t.assignedTo ? ` → ${t.assignedTo}` : " · unassigned"}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`text-xs ${
                    t.isOverdue ? "font-medium text-rose-600" : "text-slate-400"
                  }`}
                >
                  {dueLabel(t.dueAt, t.isOverdue)}
                </span>
                <span className={`text-xs ${PRIORITY_CHIP[t.priority] ?? ""}`}>
                  {t.priority !== "NORMAL" ? t.priority.toLowerCase() : ""}
                </span>
              </div>
            </button>
          ))}

          {!loading && rows.length === 0 && (
            <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] px-4 py-10 text-center text-sm text-slate-400">
              Nothing here.
            </div>
          )}
          {loading && (
            <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] px-4 py-10 text-center text-sm text-slate-400">
              Loading…
            </div>
          )}
        </div>

        {/* --- detail ----------------------------------------------------- */}
        <div>
          {openId ? (
            <TicketThread
              ticketId={openId}
              onChanged={() => void load()}
              onError={setError}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-indigo-200 px-6 py-20 text-center text-sm text-slate-400">
              Pick a ticket to open the conversation.
            </div>
          )}
        </div>
      </div>

      {raising && (
        <RaiseDrawer
          onClose={() => setRaising(false)}
          onRaised={(ref) => {
            setRaising(false);
            setError("");
            void load();
            alert(`Ticket ${ref} raised.`);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

// ===========================================================================
// THREAD
// ===========================================================================

function TicketThread({
  ticketId,
  onChanged,
  onError,
}: {
  ticketId: string;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await call<{ ticket: TicketDetail }>(`/tickets/${ticketId}`);
      setTicket(data.ticket);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not open that ticket");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await call(`/tickets/${ticketId}/messages`, "POST", {
        body: reply,
        isInternal: internal,
      });
      setReply("");
      setInternal(false);
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not send that");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await call(`/tickets/${ticketId}`, "PATCH", { status });
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update the status");
    } finally {
      setBusy(false);
    }
  }

  async function approveCorrection() {
    setBusy(true);
    try {
      await call(`/tickets/${ticketId}/apply`, "POST", {});
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not apply the correction");
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) {
    return (
      <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] px-6 py-20 text-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  const isCorrection = ticket.category === "ATTENDANCE_CORRECTION";

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-400">{ticket.reference}</p>
            <h2 className="mt-1 text-lg font-medium text-slate-900">{ticket.subject}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {CATEGORY_LABELS[ticket.category] ?? ticket.category} · raised by{" "}
              {ticket.raisedBy.firstName} {ticket.raisedBy.lastName} on{" "}
              {when(ticket.createdAt)}
              {ticket.assignedTo
                ? ` · assigned to ${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`
                : " · unassigned"}
            </p>
          </div>
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${
              STATUS_CHIP[ticket.status] ?? "bg-[#F6F7FE] text-slate-600 ring-slate-200"
            }`}
          >
            {ticket.status.toLowerCase().replace(/_/g, " ")}
          </span>
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
          {ticket.description}
        </p>
      </div>

      {/* correction panel */}
      {isCorrection && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">
            Requested times
          </p>
          <div className="mt-2 grid gap-2 text-sm text-slate-800 sm:grid-cols-3">
            <div>
              <span className="block text-xs text-slate-500">Date</span>
              {String(ticket.correctionDate ?? "—").slice(0, 10)}
            </div>
            <div>
              <span className="block text-xs text-slate-500">Clock in</span>
              {ticket.requestedLoginAt ? when(ticket.requestedLoginAt) : "unchanged"}
            </div>
            <div>
              <span className="block text-xs text-slate-500">Clock out</span>
              {ticket.requestedLogoutAt ? when(ticket.requestedLogoutAt) : "unchanged"}
            </div>
          </div>

          {ticket.appliedAt ? (
            <p className="mt-4 text-sm text-emerald-700">
              Applied to the work session on {when(ticket.appliedAt)}. It cannot be
              applied again.
            </p>
          ) : ticket.permissions.canApplyCorrection ? (
            <div className="mt-4 flex gap-2">
              <button
                onClick={approveCorrection}
                disabled={busy}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                Approve and apply
              </button>
              <button
                onClick={() => setStatus("REJECTED")}
                disabled={busy}
                className="rounded-xl border border-indigo-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Waiting on {ticket.assignedTo?.firstName ?? "an approver"}.
            </p>
          )}
        </div>
      )}

      {/* thread */}
      <div className="rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <ul className="divide-y divide-indigo-50">
          {ticket.messages.map((m) => (
            <li
              key={m.id}
              className={`px-5 py-4 ${m.isInternal ? "bg-amber-50/60" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{m.author}</span>
                <span className="text-xs text-slate-400">{when(m.createdAt)}</span>
                {m.isInternal && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    internal — not visible to the raiser
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{m.body}</p>
            </li>
          ))}
          {ticket.messages.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">
              No replies yet.
            </li>
          )}
        </ul>

        {ticket.permissions.canReply && (
          <div className="border-t border-indigo-100 p-4">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              placeholder="Write a reply…"
              className="w-full resize-none rounded-xl border border-indigo-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {ticket.permissions.canAddInternalNote && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={internal}
                    onChange={(e) => setInternal(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-indigo-200"
                  />
                  Internal note
                </label>
              )}

              <button
                onClick={send}
                disabled={busy || !reply.trim()}
                className="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {busy ? "Sending…" : "Reply"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* status actions */}
      {ticket.permissions.canChangeStatus && (
        <div className="flex flex-wrap gap-2">
          {["IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={busy || ticket.status === s}
              className="rounded-xl border border-indigo-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:opacity-30"
            >
              Mark {s.toLowerCase().replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// RAISE
// ===========================================================================

function RaiseDrawer({
  onClose,
  onRaised,
  onError,
}: {
  onClose: () => void;
  onRaised: (reference: string) => void;
  onError: (m: string) => void;
}) {
  const [category, setCategory] = useState("HR_QUERY");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [correctionDate, setCorrectionDate] = useState(todayIso());
  const [loginAt, setLoginAt] = useState("");
  const [logoutAt, setLogoutAt] = useState("");
  const [busy, setBusy] = useState(false);

  const isCorrection = category === "ATTENDANCE_CORRECTION";

  async function submit() {
    setBusy(true);
    try {
      const res = await call<{ ticket: { reference: string } }>("/tickets", "POST", {
        category,
        subject,
        description,
        priority,
        ...(isCorrection
          ? {
              correctionDate,
              requestedLoginAt: loginAt ? new Date(loginAt).toISOString() : undefined,
              requestedLogoutAt: logoutAt ? new Date(logoutAt).toISOString() : undefined,
            }
          : {}),
      });
      onRaised(res.ticket.reference);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not raise that ticket");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-indigo-100 bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-indigo-100 bg-white px-6 py-4">
          <h2 className="font-medium text-slate-900">Raise a ticket</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            ✕
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-indigo-200 px-3 py-2 text-sm"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              {isCorrection
                ? "Goes to your team manager. Approving it rewrites that day's session."
                : category === "HR_QUERY"
                  ? "Goes to HR. Target response 24 hours."
                  : category === "TECH_ISSUE"
                    ? "Goes to Admin. Target response 8 hours."
                    : "Goes to Admin. Target response 48 hours."}
            </p>
          </div>

          {isCorrection && (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Date to correct
                </label>
                <input
                  type="date"
                  value={correctionDate}
                  max={todayIso()}
                  onChange={(e) => setCorrectionDate(e.target.value)}
                  className="w-full rounded-xl border border-indigo-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Clocked in at
                  </label>
                  <input
                    type="datetime-local"
                    value={loginAt}
                    onChange={(e) => setLoginAt(e.target.value)}
                    className="w-full rounded-xl border border-indigo-200 px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Clocked out at
                  </label>
                  <input
                    type="datetime-local"
                    value={logoutAt}
                    onChange={(e) => setLogoutAt(e.target.value)}
                    className="w-full rounded-xl border border-indigo-200 px-2 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Leave one blank to leave that time unchanged.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="One line"
              className="w-full rounded-xl border border-indigo-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What happened, and what you need"
              className="w-full resize-none rounded-xl border border-indigo-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-xl border border-indigo-200 px-3 py-2 text-sm"
            >
              {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={submit}
            disabled={busy || !subject.trim() || !description.trim()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "Raising…" : "Raise ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}