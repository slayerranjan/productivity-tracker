"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { Modal } from "../_employees/Modal";
import { fmtClock } from "../_timesheet/time";
import type { Timesheet } from "../_timesheet/types";
import { CORRECTION_TYPES } from "./types";

// ---------------------------------------------------------------------------
// REQUEST ATTENDANCE CORRECTION
// The employee ASKS here. Submitting changes nothing in their attendance; HR
// decides. The form shows what the system has recorded for the chosen day so
// the request is specific.
// ---------------------------------------------------------------------------

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file"));
    r.readAsDataURL(file);
  });

const shift = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export default function RequestCorrectionModal({ date, onClose, onDone }: { date?: string; onClose: () => void; onDone: () => void }) {
  const [today, setToday] = useState("");
  const [tz, setTz] = useState("Asia/Kolkata");
  const [day, setDay] = useState(date ?? "");
  const [recorded, setRecorded] = useState<{ login: string | null; logout: string | null } | "loading" | null>("loading");
  const [type, setType] = useState("MISSING_CHECKIN");
  const [login, setLogin] = useState("");
  const [logout, setLogout] = useState("");
  const [nextDay, setNextDay] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // One call tells us today's date (in the company's timezone) and the company timezone.
  useEffect(() => {
    let live = true;
    apiGet<Timesheet>("/tracker/timesheet")
      .then((t) => {
        if (!live) return;
        setToday(t.today);
        setTz(t.timezone);
        setDay((d) => d || t.today);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // What the system has for the chosen day.
  useEffect(() => {
    if (!day) return;
    let live = true;
    apiGet<Timesheet>(`/tracker/timesheet?from=${day}&to=${day}`)
      .then((t) => {
        if (!live) return;
        const s = t.days[0]?.session;
        setRecorded(s ? { login: s.loginAt, logout: s.logoutAt } : null);
        setTz(t.timezone);
      })
      .catch(() => live && setRecorded(null));
    return () => {
      live = false;
    };
  }, [day]);

  const needsLogin = type === "MISSING_CHECKIN" || type === "FORGOT_CLOCK_IN";
  const needsLogout = type === "MISSING_CHECKOUT";
  const overnight = login !== "" && logout !== "" && logout < login;
  const invalid = !day || reason.trim().length < 5 || (!login && !logout) || (needsLogin && !login) || (needsLogout && !logout);

  async function submit() {
    if (busy || invalid) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("/attendance-corrections", {
        date: day,
        correctionType: type,
        requestedLogin: login || null,
        requestedLogout: logout || null,
        logoutNextDay: overnight && nextDay,
        reason,
        attachment: file ? { fileName: file.name, data: await readFile(file), mimeType: file.type } : null,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2.5 text-sm text-slate-800";
  return (
    <Modal
      title="Request attendance correction"
      subtitle="HR reviews it first. Your attendance only changes if HR approves."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button>
          <button disabled={busy || invalid} onClick={submit} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-slate-600">
            Attendance date
            <input type="date" value={day} min={today ? shift(today, -30) : undefined} max={today || undefined} onChange={(e) => { setRecorded("loading"); setDay(e.target.value); }} className={input} />
          </label>
          <label className="block text-sm text-slate-600">
            What went wrong
            <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
              {CORRECTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Currently recorded</p>
          {recorded === "loading" ? (
            <p className="mt-1 text-slate-400">Checking…</p>
          ) : recorded ? (
            <p className="mt-1">
              Check-in <b className="text-slate-900">{fmtClock(Date.parse(recorded.login ?? ""), tz)}</b> · Check-out{" "}
              <b className="text-slate-900">{recorded.logout ? fmtClock(Date.parse(recorded.logout), tz) : "not recorded"}</b>
            </p>
          ) : (
            <p className="mt-1">Nothing is recorded for this day.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-slate-600">
            Correct check-in{needsLogin ? " *" : ""}
            <input type="time" value={login} onChange={(e) => setLogin(e.target.value)} className={input} />
          </label>
          <label className="block text-sm text-slate-600">
            Correct check-out{needsLogout ? " *" : ""}
            <input type="time" value={logout} onChange={(e) => setLogout(e.target.value)} className={input} />
          </label>
        </div>
        {overnight && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} /> The check-out was after midnight (the next day)
          </label>
        )}
        <p className="-mt-2 text-xs text-slate-400">Times are in your company&apos;s timezone ({tz}). Fill in only what needs changing. Leave the other blank.</p>

        <label className="block text-sm text-slate-600">
          Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className={input} placeholder="What happened? For example: the biometric machine did not scan me in." />
        </label>
        <label className="block text-sm text-slate-600">
          Supporting evidence (optional)
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
        </label>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
