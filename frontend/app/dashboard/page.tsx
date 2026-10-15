"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useMe } from "./layout";

type Break = {
  id: string;
  breakType: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
};

type Meeting = {
  id: string;
  meetingType: string;
  title: string | null;
  approvalStatus: string;
  startedAt: string | null;
  endedAt: string | null;
  invitedBy?: { firstName: string; lastName: string; role: string } | null;
};

type Session = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  loginAt: string;
  logoutAt: string | null;
  productiveSeconds: number;
  breakSeconds: number;
  meetingSeconds: number;
  wasLateLogin: boolean;
  lateByMinutes: number;
  breaks: Break[];
  meetings: Meeting[];
};

type Config = {
  dailyWorkHours: number;
  productiveHours: number;
  breakBudgetMinutes: number;
};

const BREAK_TYPES = [
  { value: "TEA", label: "Tea" },
  { value: "LUNCH", label: "Lunch" },
  { value: "WASHROOM", label: "Washroom" },
  { value: "PERSONAL", label: "Personal" },
  { value: "OTHER", label: "Other" },
];

const MEETING_LABELS: Record<string, string> = {
  TEAM: "team meeting",
  ONE_ON_ONE: "one-on-one",
  CLIENT: "client call",
  TRAINING: "training session",
  INTERVIEW: "interview",
  OTHER: "meeting",
};

function hms(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function TodayPage() {
  const me = useMe();
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [invites, setInvites] = useState<Meeting[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showBreaks, setShowBreaks] = useState(false);
  const fetchedAt = useRef<number>(Date.now());
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ session: Session | null; config: Config }>(
        "/tracker/session"
      );
      setSession(res.session);
      setConfig(res.config);
      fetchedAt.current = Date.now();
      setError("");

      const pending = await apiGet<Meeting[]>("/tracker/invites");
      setInvites(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your day");
    }
  }, []);

  // First load, then poll. The timer ticks locally every second and
  // self-corrects against the server every 20.
  useEffect(() => {
    load();
    const poll = setInterval(load, 20000);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await apiPost(path, body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
      setShowBreaks(false);
    }
  }

  if (!me) return null;

  const openBreak = session?.breaks.find((b) => !b.endedAt) ?? null;
  const openMeeting =
    session?.meetings.find(
      (m) => m.approvalStatus === "APPROVED" && m.startedAt && !m.endedAt
    ) ?? null;

  const running = session?.status === "ACTIVE";
  const elapsedSinceFetch = running ? (Date.now() - fetchedAt.current) / 1000 : 0;

  const productive =
    (session?.productiveSeconds ?? 0) +
    (running && !openBreak && !openMeeting ? elapsedSinceFetch : 0);
  const breakSecs =
    (session?.breakSeconds ?? 0) + (openBreak ? elapsedSinceFetch : 0);
  const meetingSecs =
    (session?.meetingSeconds ?? 0) + (openMeeting ? elapsedSinceFetch : 0);

  const targetSecs = (config?.productiveHours ?? 8) * 3600;
  const budgetSecs = (config?.breakBudgetMinutes ?? 60) * 60;
  const progress = Math.min(100, (productive / targetSecs) * 100);
  const breakUsed = Math.min(100, (breakSecs / budgetSecs) * 100);
  const overBudget = breakSecs > budgetSecs;

  const state = !session
    ? { label: "Not clocked in", dot: "bg-slate-300", text: "text-slate-500" }
    : session.status === "COMPLETED"
    ? { label: "Day complete", dot: "bg-slate-400", text: "text-slate-500" }
    : openBreak
    ? { label: "On break", dot: "bg-amber-500", text: "text-amber-700" }
    : openMeeting
    ? { label: "In a meeting", dot: "bg-violet-500", text: "text-violet-700" }
    : { label: "Working", dot: "bg-emerald-500", text: "text-emerald-700" };

  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-6">
        <p className="text-sm text-slate-400">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-0.5">
          {new Date().getHours() < 12
            ? "Good morning"
            : new Date().getHours() < 17
            ? "Good afternoon"
            : "Good evening"}
          , {me.firstName}
        </h1>
      </header>

      {invites.map((invite) => (
        <div
          key={invite.id}
          className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4 flex items-center justify-between gap-4 animate-pulse"
        >
          <div>
                        <p className="text-sm font-medium text-violet-900">
              {invite.invitedBy
                ? `${invite.invitedBy.firstName} ${invite.invitedBy.lastName}`
                : "Your manager"}{" "}
              invited you to a{" "}
              {MEETING_LABELS[invite.meetingType] ?? "meeting"}
            </p>
            <p className="text-xs text-violet-700 mt-0.5">
              {invite.title ? `${invite.title} · ` : ""}
              your clock starts when you accept
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              disabled={busy}
              onClick={() =>
                act(`/tracker/invites/${invite.id}/respond`, { accept: true })
              }
              className="rounded-lg bg-violet-600 text-white text-sm font-medium px-4 py-2 hover:bg-violet-700 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act(`/tracker/invites/${invite.id}/respond`, { accept: false })
              }
              className="rounded-lg border border-violet-300 text-violet-700 text-sm font-medium px-4 py-2 hover:bg-violet-100 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
            <span className={`text-sm font-medium ${state.text}`}>
              {state.label}
            </span>
          </div>
          {session && (
            <p className="text-xs text-slate-400">
              In at{" "}
              {new Date(session.loginAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {session.wasLateLogin && (
                <span className="ml-2 text-amber-600">
                  late by {session.lateByMinutes}m
                </span>
              )}
            </p>
          )}
        </div>

        <div className="px-6 py-7 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="sm:col-span-1">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
              Productive
            </p>
            <p className="text-4xl font-semibold text-slate-900 tabular-nums tracking-tight">
              {hms(productive)}
            </p>
            <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              target {config?.productiveHours ?? 8}h
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
              Break
            </p>
            <p
              className={`text-4xl font-semibold tabular-nums tracking-tight ${
                overBudget ? "text-red-600" : "text-slate-900"
              }`}
            >
              {hms(breakSecs)}
            </p>
            <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  overBudget ? "bg-red-500" : "bg-amber-500"
                }`}
                style={{ width: `${breakUsed}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              budget {config?.breakBudgetMinutes ?? 60}m
              {overBudget && (
                <span className="text-red-600 font-medium"> · over</span>
              )}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
              Meetings
            </p>
            <p className="text-4xl font-semibold text-slate-900 tabular-nums tracking-tight">
              {hms(meetingSecs)}
            </p>
            <p className="text-xs text-slate-400 mt-5">
              {session?.meetings.filter((m) => m.approvalStatus === "APPROVED")
                .length ?? 0}{" "}
              today
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex flex-wrap gap-2.5">
          {!running && (
            <button
              disabled={busy}
              onClick={() => act("/tracker/clock-in")}
              className="rounded-lg bg-slate-900 text-white text-sm font-medium px-5 py-2.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {session?.status === "COMPLETED" ? "Clock back in" : "Clock in"}
            </button>
          )}

          {running && !openBreak && !openMeeting && (
            <div className="relative">
              <button
                disabled={busy}
                onClick={() => setShowBreaks((s) => !s)}
                className="rounded-lg bg-amber-500 text-white text-sm font-medium px-5 py-2.5 hover:bg-amber-600 disabled:opacity-50"
              >
                Take a break
              </button>
              {showBreaks && (
                <div className="absolute z-10 mt-1.5 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                  {BREAK_TYPES.map((b) => (
                    <button
                      key={b.value}
                      onClick={() =>
                        act("/tracker/break/start", { breakType: b.value })
                      }
                      className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {openBreak && (
            <button
              disabled={busy}
              onClick={() => act("/tracker/break/end")}
              className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-5 py-2.5 hover:bg-emerald-700 disabled:opacity-50"
            >
              Back from break
            </button>
          )}

          {openMeeting && (
            <button
              disabled={busy}
              onClick={() => act("/tracker/meeting/end")}
              className="rounded-lg bg-violet-600 text-white text-sm font-medium px-5 py-2.5 hover:bg-violet-700 disabled:opacity-50"
            >
              End meeting
            </button>
          )}

          {running && (
            <button
              disabled={busy}
              onClick={() => act("/tracker/clock-out")}
              className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-5 py-2.5 hover:bg-slate-50 disabled:opacity-50"
            >
              Clock out
            </button>
          )}
        </div>
      </section>

      {session && session.breaks.length > 0 && (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-6 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-medium text-slate-900">
              Today's breaks
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {session.breaks.map((b) => (
              <li
                key={b.id}
                className="px-6 py-3 flex items-center justify-between text-sm"
              >
                <span className="text-slate-700 capitalize">
                  {b.breakType.toLowerCase()}
                </span>
                <span className="text-slate-500 tabular-nums">
                  {new Date(b.startedAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {b.endedAt
                    ? ` · ${Math.round((b.durationSeconds ?? 0) / 60)}m`
                    : " · running"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}