"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useMe } from "../layout";
import { Modal } from "../_employees/Modal";

// ---------------------------------------------------------------------------
// MEETINGS
// Scheduled meetings with a link the organizer pastes (Google Meet, Teams, Zoom or any
// https link). Avatar HRMS does not create the meeting at those services.
// You see the meetings you organize or are invited to. HR/Admin also get an overview
// (title, organizer, time, head-count only) and can cancel a meeting.
// ---------------------------------------------------------------------------

type Person = { id: string; name: string; employeeCode: string | null };
type Meeting = {
  id: string; title: string; description: string | null; startsAt: string; endsAt: string; state: "upcoming" | "ongoing" | "past" | "cancelled";
  status: string; cancelReason: string | null; organizer: string; organizerId: string; attendees: Person[]; meetingUrl: string | null;
  provider: string | null; isOrganizer: boolean; canEdit: boolean; canCancel: boolean;
};
type List = { timezone: string; canCreate: boolean; counts: { upcoming: number; past: number; cancelled: number }; meetings: Meeting[] };
type Oversight = { timezone: string; meetings: { id: string; title: string; startsAt: string; endsAt: string; status: string; organizer: string; attendeeCount: number; canCancel: boolean }[] };

const card = "rounded-2xl bg-white shadow-[var(--shadow-card)]";
const dayFmt = (s: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(s));
const timeFmt = (s: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(s));
const range = (m: { startsAt: string; endsAt: string }, tz: string) => `${timeFmt(m.startsAt, tz)} – ${timeFmt(m.endsAt, tz)}`;
const hhmm = (s: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s));
const ymd = (s: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s));

function useApi<T>(path: string | null, reload: number) {
  const [res, setRes] = useState<{ path: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    apiGet<T>(path)
      .then((data) => live && setRes({ path, data }))
      .catch((e: Error) => live && setRes((prev) => ({ path, data: prev?.data, error: e.message })));
    return () => {
      live = false;
    };
  }, [path, reload]);
  return { data: res?.data ?? null, error: res && res.path === path ? (res.error ?? "") : "" };
}

function MeetingsInner() {
  const me = useMe();
  const isHr = me?.role === "HR" || me?.role === "ADMIN";
  const linked = useSearchParams().get("id");
  const [tab, setTab] = useState<"upcoming" | "past" | "cancelled" | "overview">("upcoming");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  // A link like /dashboard/meetings?id=... (from a notification) opens that meeting, even if you are already on this page.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [closedLink, setClosedLink] = useState<string | null>(null);
  const openId = chosenId ?? (linked && linked !== closedLink ? linked : null);
  const setOpenId = (id: string | null) => {
    setChosenId(id);
    if (id === null) setClosedLink(linked);
  };
  const [editing, setEditing] = useState<Meeting | "new" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const scope = tab === "overview" ? "upcoming" : tab;
  const list = useApi<List>(tab === "overview" ? null : `/meetings?scope=${scope}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`, reload);
  const counts = useApi<List>("/meetings?scope=upcoming", reload);
  const [overScope, setOverScope] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const over = useApi<Oversight>(tab === "overview" && isHr ? `/meetings/oversight?scope=${overScope}` : null, reload);
  const tz = list.data?.timezone ?? counts.data?.timezone ?? over.data?.timezone ?? "Asia/Kolkata";
  const c = counts.data?.counts;
  const tabs: ["upcoming" | "past" | "cancelled" | "overview", string][] = [
    ["upcoming", `Upcoming${c ? ` (${c.upcoming})` : ""}`], ["past", `Past${c ? ` (${c.past})` : ""}`], ["cancelled", `Cancelled${c ? ` (${c.cancelled})` : ""}`],
    ...(isHr ? ([["overview", "Company overview"]] as ["overview", string][]) : []),
  ];
  const canCreate = counts.data?.canCreate ?? false;

  return (
    <div className="page-fluid space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Meetings</h1>
          <p className="mt-1 text-sm text-slate-500">Meetings you organize or are invited to. Join with the link the organizer added.</p>
        </div>
        {canCreate && <button onClick={() => setEditing("new")} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">New meeting</button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setNotice(""); }} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-indigo-50"}`}>{label}</button>
        ))}
        {tab !== "overview" && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" aria-label="Search meetings" className="ml-auto w-56 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-sm" />}
      </div>

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      {tab !== "overview" && (
        <section className={`${card} p-5`}>
          {list.error && <p className="mb-3 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t load meetings: {list.error}<button onClick={() => setReload((n) => n + 1)} className="ml-3 rounded-lg bg-white px-3 py-1 text-xs font-medium ring-1 ring-red-200">Retry</button></p>}
          {!list.data && !list.error && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div>}
          {list.data && list.data.meetings.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">{dq ? "No meetings match your search." : tab === "upcoming" ? "No upcoming meetings." : tab === "past" ? "No past meetings." : "No cancelled meetings."}</p>
          )}
          <div className="divide-y divide-indigo-100">
            {list.data?.meetings.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="w-14 shrink-0 rounded-xl bg-indigo-50 py-2 text-center">
                    <p className="text-[11px] font-medium uppercase text-indigo-500">{new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(new Date(m.startsAt))}</p>
                    <p className="text-lg font-semibold leading-none text-indigo-700">{new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit" }).format(new Date(m.startsAt))}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {m.title}
                      {m.state === "ongoing" && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Happening now</span>}
                      {m.state === "cancelled" && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">Cancelled</span>}
                    </p>
                    <p className="text-sm text-slate-500">{dayFmt(m.startsAt, tz)} · {range(m, tz)}</p>
                    <p className="text-xs text-slate-400">{m.isOrganizer ? "You are organizing" : `Organized by ${m.organizer}`} · {m.attendees.length} invited{m.provider ? ` · ${m.provider}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.meetingUrl && (m.state === "upcoming" || m.state === "ongoing") && (
                    <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Join meeting</a>
                  )}
                  <button onClick={() => setOpenId(m.id)} className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Details</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "overview" && isHr && (
        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">Every meeting in your company, with only the title, organizer, time and head-count. Descriptions, links and who is invited stay private to the organizer and attendees.</p>
            <select aria-label="Overview scope" value={overScope} onChange={(e) => setOverScope(e.target.value as typeof overScope)} className="rounded-xl border border-indigo-100 bg-white px-3 py-2 text-sm">
              <option value="upcoming">Upcoming</option><option value="past">Past</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
          {over.error && <p className="mt-3 text-sm text-red-600">{over.error}</p>}
          {!over.data && !over.error && <div className="mt-4 space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>}
          {over.data && over.data.meetings.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No meetings.</p>}
          {over.data && over.data.meetings.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead><tr className="text-xs text-slate-400"><th className="py-2 font-medium">Meeting</th><th className="py-2 font-medium">When</th><th className="py-2 font-medium">Organizer</th><th className="py-2 text-right font-medium">Invited</th><th className="py-2" /></tr></thead>
                <tbody className="divide-y divide-indigo-100">
                  {over.data.meetings.map((m) => (
                    <tr key={m.id}>
                      <td className="py-3 font-medium text-slate-900">{m.title}</td>
                      <td className="py-3 text-slate-600">{dayFmt(m.startsAt, tz)} · {range(m, tz)}</td>
                      <td className="py-3 text-slate-600">{m.organizer}</td>
                      <td className="py-3 text-right tabular-nums text-slate-600">{m.attendeeCount}</td>
                      <td className="py-3 text-right">{m.canCancel && <CancelInline id={m.id} onDone={() => { setNotice("Meeting cancelled. The people invited were notified."); setReload((n) => n + 1); }} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {openId && <DetailsModal id={openId} tz={tz} onClose={() => setOpenId(null)} onEdit={(m) => { setOpenId(null); setEditing(m); }} onChanged={(t) => { setOpenId(null); setNotice(t); setReload((n) => n + 1); }} />}
      {editing && <EditModal meeting={editing === "new" ? null : editing} tz={tz} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNotice(t); setReload((n) => n + 1); }} />}
    </div>
  );
}

function CancelInline({ id, onDone }: { id: string; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!asking) return <button onClick={() => setAsking(true)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Cancel meeting</button>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (optional)" className="w-44 rounded-lg border border-indigo-100 px-2 py-1 text-xs" />
      <button disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { await apiPost(`/meetings/${id}/cancel`, { reason }); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); } }} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Confirm</button>
      <button onClick={() => setAsking(false)} className="text-xs text-slate-500">Back</button>
      {err && <span className="w-full text-xs text-red-600">{err}</span>}
    </span>
  );
}

function DetailsModal({ id, tz, onClose, onEdit, onChanged }: { id: string; tz: string; onClose: () => void; onEdit: (m: Meeting) => void; onChanged: (t: string) => void }) {
  const { data: m, error } = useApi<Meeting & { timezone: string }>(`/meetings/${id}`, 0);
  return (
    <Modal title={m?.title ?? "Meeting"} subtitle={m ? `${dayFmt(m.startsAt, tz)} · ${range(m, tz)}` : undefined} onClose={onClose} width="max-w-lg">
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!m && !error && <div className="skeleton h-32" aria-busy="true" />}
      {m && (
        <div className="space-y-4 text-sm">
          {m.state === "cancelled" && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">This meeting was cancelled{m.cancelReason ? `: ${m.cancelReason}` : "."}</p>}
          <dl className="divide-y divide-indigo-100 rounded-2xl border border-indigo-100">
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Organizer</dt><dd className="font-medium text-slate-900">{m.organizer}</dd></div>
            {m.provider && <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-slate-500">Link</dt><dd className="font-medium text-slate-900">{m.provider}</dd></div>}
          </dl>
          {m.description && <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">About</p><p className="mt-1 whitespace-pre-wrap text-slate-700">{m.description}</p></div>}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invited ({m.attendees.length})</p>
            <div className="mt-1 flex flex-wrap gap-1.5">{m.attendees.map((a) => <span key={a.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{a.name}</span>)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {m.canEdit && <button onClick={() => onEdit(m)} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Edit</button>}
            {m.canCancel && <CancelInline id={m.id} onDone={() => onChanged("Meeting cancelled. The people invited were notified.")} />}
            {m.meetingUrl && (m.state === "upcoming" || m.state === "ongoing") && <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Join meeting</a>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditModal({ meeting, tz, onClose, onDone }: { meeting: Meeting | null; tz: string; onClose: () => void; onDone: (t: string) => void }) {
  const people = useApi<{ people: (Person & { designation: string | null })[] }>("/meetings/people", 0);
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [description, setDescription] = useState(meeting?.description ?? "");
  const [date, setDate] = useState(meeting ? ymd(meeting.startsAt, tz) : "");
  const [start, setStart] = useState(meeting ? hhmm(meeting.startsAt, tz) : "10:00");
  const [end, setEnd] = useState(meeting ? hhmm(meeting.endsAt, tz) : "11:00");
  const [url, setUrl] = useState(meeting?.meetingUrl ?? "");
  const [picked, setPicked] = useState<string[]>(meeting?.attendees.map((a) => a.id) ?? []);
  const [find, setFind] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = (people.data?.people ?? []).filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase()) || (p.employeeCode ?? "").toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const invalid = title.trim().length < 2 || !date || !start || !end || end <= start || picked.length === 0;

  async function save() {
    if (busy || invalid) return;
    setBusy(true);
    setError("");
    const body = { title, description, date, startTime: start, endTime: end, meetingUrl: url, attendeeIds: picked };
    try {
      if (meeting) await apiPatch(`/meetings/${meeting.id}`, body);
      else await apiPost("/meetings", body);
      onDone(meeting ? "Meeting updated. The people invited were notified." : "Meeting scheduled. The people invited were notified.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const input = "mt-1 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2.5 text-sm text-slate-800";
  return (
    <Modal title={meeting ? "Edit meeting" : "New meeting"} subtitle="Paste an existing Google Meet, Teams or Zoom link. Avatar HRMS does not create the meeting for you." onClose={onClose} width="max-w-xl"
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button><button disabled={busy || invalid} onClick={save} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "Saving…" : meeting ? "Save changes" : "Schedule"}</button></div>}>
      <div className="space-y-4">
        <label className="block text-sm text-slate-600">Title<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="block text-sm text-slate-600">Description (optional)<textarea value={description} maxLength={1000} rows={2} onChange={(e) => setDescription(e.target.value)} className={input} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm text-slate-600">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
          <label className="block text-sm text-slate-600">Starts<input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} /></label>
          <label className="block text-sm text-slate-600">Ends<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} /></label>
        </div>
        <p className="-mt-2 text-xs text-slate-400">Times are in your company&apos;s timezone ({tz}).</p>
        <label className="block text-sm text-slate-600">Meeting link (optional)<input value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/..." className={input} /></label>
        <div>
          <p className="text-sm text-slate-600">Invite people <span className="text-slate-400">({picked.length} chosen)</span></p>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search name or ID" className={input} />
          <div className="mt-2 max-h-44 divide-y divide-indigo-50 overflow-y-auto rounded-xl border border-indigo-100">
            {!people.data && !people.error && <p className="px-3 py-3 text-sm text-slate-400">Loading people…</p>}
            {people.error && <p className="px-3 py-3 text-sm text-red-600">{people.error}</p>}
            {shown.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-indigo-50/40">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="text-slate-800">{p.name}</span><span className="text-xs text-slate-400">{p.employeeCode}{p.designation ? ` · ${p.designation}` : ""}</span>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={null}>
      <MeetingsInner />
    </Suspense>
  );
}
