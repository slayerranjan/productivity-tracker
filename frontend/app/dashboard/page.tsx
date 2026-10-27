// ===========================================================================
// TODAY
//
// The hero is the day itself, drawn as a strip: green where you worked,
// amber where you were on break, violet for meetings.
//
// Break types are four visible buttons rather than a dropdown. The old menu
// was absolutely positioned inside a section with overflow-hidden, so the
// browser clipped it and the button appeared dead.
//
// BUILT FOR A MINIMISED TAB
// People work with this hidden, so: the tab title carries the live state, a
// meeting invite raises a desktop notification, and the page re-syncs the
// moment it regains focus. Background tabs have their timers throttled, so
// nothing here counts upwards — every figure is derived from timestamps and
// is correct whenever it next renders.
// ===========================================================================

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
  { value: "WASHROOM", label: "Bio" },
  { value: "PERSONAL", label: "Personal" },
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
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function hm(total: number) {
  return hms(total).slice(0, 5);
}

function clockTime(iso: string | number) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Segment = { start: number; end: number; kind: "productive" | "break" | "meeting" };

function buildSegments(session: Session, now: number): Segment[] {
  const login = new Date(session.loginAt).getTime();
  const finish = session.logoutAt ? new Date(session.logoutAt).getTime() : now;

  const spans: { start: number; end: number; kind: "break" | "meeting" }[] = [];

  for (const b of session.breaks) {
    spans.push({
      start: new Date(b.startedAt).getTime(),
      end: b.endedAt ? new Date(b.endedAt).getTime() : finish,
      kind: "break",
    });
  }
  for (const m of session.meetings) {
    if (m.approvalStatus !== "APPROVED" || !m.startedAt) continue;
    spans.push({
      start: new Date(m.startedAt).getTime(),
      end: m.endedAt ? new Date(m.endedAt).getTime() : finish,
      kind: "meeting",
    });
  }

  spans.sort((a, z) => a.start - z.start);

  const segments: Segment[] = [];
  let cursor = login;

  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    if (start > cursor) segments.push({ start: cursor, end: start, kind: "productive" });
    if (span.end > start) segments.push({ start, end: span.end, kind: span.kind });
    cursor = Math.max(cursor, span.end);
  }

  if (finish > cursor) segments.push({ start: cursor, end: finish, kind: "productive" });
  return segments;
}

const SEGMENT_FILL: Record<Segment["kind"], string> = {
  productive: "bg-emerald-400",
  break: "bg-amber-400",
  meeting: "bg-violet-400",
};

export default function TodayPage() {
  const me = useMe();
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  // True while a meeting this person called is still running, so the End
  // button appears and disappears on its own, on every device.
  const [hostsMeeting, setHostsMeeting] = useState(false);
  const [invites, setInvites] = useState<Meeting[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canNotify, setCanNotify] = useState(false);
  const fetchedAt = useRef<number>(Date.now());
  const notified = useRef<Set<string>>(new Set());
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ session: Session | null; config: Config; hostsOpenMeeting?: boolean }>(
        "/tracker/session"
      );
      setSession(res.session);
      setConfig(res.config);
      setHostsMeeting(Boolean(res.hostsOpenMeeting));
      fetchedAt.current = Date.now();
      setError("");

      const pending = await apiGet<Meeting[]>("/tracker/invites");
      setInvites(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your day");
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 20000);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // A hidden tab has its timers throttled, so the poll above may not have run
  // for a minute. Re-sync the instant someone comes back to the window.
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [load]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setCanNotify(Notification.permission === "granted");
    }
  }, []);

  async function askToNotify() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setCanNotify(result === "granted");
  }

  useEffect(() => {
    if (!canNotify) return;
    for (const invite of invites) {
      if (notified.current.has(invite.id)) continue;
      notified.current.add(invite.id);
      const from = invite.invitedBy
        ? `${invite.invitedBy.firstName} ${invite.invitedBy.lastName}`
        : "Your manager";
      new Notification("Meeting invite", {
        body: `${from} invited you to a ${MEETING_LABELS[invite.meetingType] ?? "meeting"}. Your clock starts when you accept.`,
        tag: invite.id,
      });
    }
  }, [invites, canNotify]);

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
    }
  }

  const openBreak = session?.breaks.find((b) => !b.endedAt) ?? null;
  const openMeeting =
    session?.meetings.find(
      (m) => m.approvalStatus === "APPROVED" && m.startedAt && !m.endedAt
    ) ?? null;

  const running = session?.status === "ACTIVE";
  const now = Date.now();
  const sinceFetch = running ? (now - fetchedAt.current) / 1000 : 0;

  const productive =
    (session?.productiveSeconds ?? 0) +
    (running && !openBreak && !openMeeting ? sinceFetch : 0);
  const breakSecs = (session?.breakSeconds ?? 0) + (openBreak ? sinceFetch : 0);
  const meetingSecs = (session?.meetingSeconds ?? 0) + (openMeeting ? sinceFetch : 0);

  // The tab strip is the display when this window is minimised.
  useEffect(() => {
    if (!running) {
      document.title = "Tracker";
      return;
    }
    document.title = openBreak
      ? `☕ ${hm(breakSecs)} break · Tracker`
      : openMeeting
        ? `👥 ${hm(meetingSecs)} meeting · Tracker`
        : `⏱ ${hm(productive)} · Tracker`;
  });

  if (!me) return null;

  const targetSecs = (config?.productiveHours ?? 8) * 3600;
  const budgetSecs = (config?.breakBudgetMinutes ?? 60) * 60;
  const progress = Math.min(100, (productive / targetSecs) * 100);
  const budgetLeft = budgetSecs - breakSecs;
  const overBudget = budgetLeft < 0;

  const state = !session
    ? { label: "Not clocked in", dot: "bg-slate-500" }
    : session.status === "COMPLETED"
      ? { label: "Day complete", dot: "bg-slate-400" }
      : openBreak
        ? { label: `On a ${openBreak.breakType.toLowerCase()} break`, dot: "bg-amber-400" }
        : openMeeting
          ? { label: "In a meeting", dot: "bg-violet-400" }
          : { label: "Working", dot: "bg-emerald-400" };

  const login = session ? new Date(session.loginAt).getTime() : now;
  const plannedEnd = login + (config?.dailyWorkHours ?? 9) * 3600_000;
  const windowEnd = Math.max(plannedEnd, now);
  const windowSpan = Math.max(1, windowEnd - login);
  const segments = session ? buildSegments(session, now) : [];

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {new Date().getHours() < 12
              ? "Good morning"
              : new Date().getHours() < 17
                ? "Good afternoon"
                : "Good evening"}
            , {me.firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>

        {session && (
          <p className="text-sm text-slate-500">
            Clocked in at{" "}
            <span className="font-medium text-slate-700">
              {clockTime(session.loginAt)}
            </span>
            {session.wasLateLogin && (
              <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {session.lateByMinutes}m late
              </span>
            )}
          </p>
        )}
      </header>

      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-300 bg-violet-50 p-4"
        >
          <div>
            <p className="text-sm font-medium text-violet-900">
              {invite.invitedBy
                ? `${invite.invitedBy.firstName} ${invite.invitedBy.lastName}`
                : "Your manager"}{" "}
              invited you to a {MEETING_LABELS[invite.meetingType] ?? "meeting"}
            </p>
            <p className="mt-0.5 text-xs text-violet-700">
              {invite.title ? `${invite.title} — ` : ""}
              your clock starts when you accept
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              disabled={busy}
              onClick={() => act(`/tracker/invites/${invite.id}/respond`, { accept: true })}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              disabled={busy}
              onClick={() => act(`/tracker/invites/${invite.id}/respond`, { accept: false })}
              className="rounded-lg border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <section className="rounded-2xl bg-slate-900 p-7 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state.dot}`} />
            <span className="text-sm font-medium text-slate-200">{state.label}</span>
          </div>

          {!canNotify && running && (
            <button
              onClick={askToNotify}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Alert me about meetings
            </button>
          )}
        </div>

        <div className="mt-6">
          <div className="relative h-14 overflow-hidden rounded-xl bg-slate-800">
            {segments.map((seg, i) => {
              const left = ((seg.start - login) / windowSpan) * 100;
              const width = ((seg.end - seg.start) / windowSpan) * 100;
              if (width <= 0) return null;
              return (
                <div
                  key={i}
                  className={`absolute inset-y-0 ${SEGMENT_FILL[seg.kind]}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
                  title={`${seg.kind} · ${clockTime(seg.start)}–${clockTime(seg.end)}`}
                />
              );
            })}

            {!session && (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Your day starts when you clock in
              </div>
            )}
          </div>

          {session && (
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>{clockTime(login)}</span>
              <span>{clockTime(windowEnd)}</span>
            </div>
          )}
        </div>

        <div className="mt-7 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-emerald-400">
              {hms(productive)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              productive — {Math.round(progress)}% of {config?.productiveHours ?? 8}h
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-emerald-400 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div>
            <p
              className={`text-3xl font-semibold tabular-nums tracking-tight ${
                overBudget ? "text-rose-400" : "text-amber-400"
              }`}
            >
              {hms(breakSecs)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {overBudget
                ? `break — ${Math.ceil(-budgetLeft / 60)}m over budget`
                : `break — ${Math.floor(budgetLeft / 60)}m left of ${
                    config?.breakBudgetMinutes ?? 60
                  }m`}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-700 ${
                  overBudget ? "bg-rose-400" : "bg-amber-400"
                }`}
                style={{ width: `${Math.min(100, (breakSecs / budgetSecs) * 100)}%` }}
              />
            </div>
          </div>

          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-violet-400">
              {hms(meetingSecs)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              meetings —{" "}
              {session?.meetings.filter((m) => m.approvalStatus === "APPROVED").length ?? 0}{" "}
              today
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        {!running && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              {session?.status === "COMPLETED"
                ? "Your day is closed. Clock back in if you're picking it up again."
                : "Nothing is being recorded yet."}
            </p>
            <button
              disabled={busy}
              onClick={() => {
                void askToNotify();
                void act("/tracker/clock-in");
              }}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {session?.status === "COMPLETED" ? "Clock back in" : "Clock in"}
            </button>
          </div>
        )}

        {running && !openBreak && !openMeeting && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">Take a break</span>

            <div className="flex flex-wrap gap-2">
              {BREAK_TYPES.map((b) => (
                <button
                  key={b.value}
                  disabled={busy}
                  onClick={() => act("/tracker/break/start", { breakType: b.value })}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
            </div>

            {hostsMeeting && ["MANAGER", "HR", "ADMIN"].includes(String(me?.role)) && (
              <button
                disabled={busy}
                onClick={() => act("/tracker/meeting/end")}
                className="rounded-lg border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                title="Ends the meeting for everyone you invited"
              >
                End team meeting
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => act("/tracker/clock-out")}
              className="ml-auto rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Clock out
            </button>
          </div>
        )}

        {openBreak && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              On a {openBreak.breakType.toLowerCase()} break since{" "}
              {clockTime(openBreak.startedAt)}.
            </p>
            <button
              disabled={busy}
              onClick={() => act("/tracker/break/end")}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Back to work
            </button>
          </div>
        )}

        {openMeeting && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              In a {MEETING_LABELS[openMeeting.meetingType] ?? "meeting"}
              {openMeeting.title ? ` — ${openMeeting.title}` : ""}.
            </p>
            <button
              disabled={busy}
              onClick={() => act("/tracker/meeting/end")}
              className={`rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50 ${["MANAGER", "HR", "ADMIN"].includes(String(me?.role)) ? "" : "hidden"}`}
            >
              End meeting
            </button>
          </div>
        )}
      </section>

      {session && session.breaks.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-medium text-slate-900">Breaks today</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {session.breaks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      b.endedAt ? "bg-amber-400" : "animate-pulse bg-amber-500"
                    }`}
                  />
                  <span className="capitalize text-slate-700">
                    {b.breakType === "WASHROOM" ? "Bio" : b.breakType.toLowerCase()}
                  </span>
                </span>
                <span className="tabular-nums text-slate-500">
                  {clockTime(b.startedAt)}
                  {b.endedAt
                    ? ` – ${clockTime(b.endedAt)} · ${Math.max(
                        1,
                        Math.round((b.durationSeconds ?? 0) / 60)
                      )}m`
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