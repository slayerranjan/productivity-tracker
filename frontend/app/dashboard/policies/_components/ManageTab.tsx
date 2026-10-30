"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiPost } from "@/lib/api";
import { card, field, fmtDate, STATUS_CHIP, STATUS_LABEL, useApi, type Manage } from "../_lib";
import PolicyForm from "./PolicyForm";

// HR / Admin: the policy dashboard (counts), a searchable table of every policy, and a place to start a new one.

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-xl border p-4 ${tone ?? "border-indigo-100 bg-white"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function ManageTab({ reload, bump, setNotice }: { reload: number; bump: () => void; setNotice: (s: string) => void }) {
  const router = useRouter();
  const { data, error } = useApi<Manage>("/policies/manage", reload);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.documents ?? []).filter((d) => (!q || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) && (!status || d.status === status) && (!category || d.category === category));
  }, [data, search, status, category]);

  async function toggle(id: string, archive: boolean) {
    if (busy) return;
    setBusy(id);
    setErr("");
    try {
      await apiPost(`/policies/${id}/${archive ? "archive" : "restore"}`);
      setNotice(archive ? "Policy archived. It stays on record for HR." : "Policy restored.");
      bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const s = data?.summary;
  return (
    <div className="space-y-5">
      {error && !data && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t load the policies: {error}</p>}
      {data && !data.schemaReady && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Drafts, versions and publishing are not switched on for this server yet (the database update is pending). Policies you add now are published straight away, as before.</p>
      )}
      {err && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total policies" value={s?.total ?? "—"} />
        <Stat label="Published" value={s?.published ?? "—"} tone="border-emerald-100 bg-emerald-50/60" />
        <Stat label="Draft" value={s?.draft ?? "—"} tone="border-amber-100 bg-amber-50/60" />
        <Stat label="Archived" value={s?.archived ?? "—"} />
        <Stat label="Confirmations required" value={s?.requiredPairs ?? "—"} sub="people × mandatory policies" />
        <Stat label="Completed" value={s?.completedPairs ?? "—"} tone="border-emerald-100 bg-emerald-50/60" />
        <Stat label="Pending" value={s?.pendingPairs ?? "—"} sub={s ? `${s.peopleWithPending} ${s.peopleWithPending === 1 ? "person" : "people"}` : undefined} tone="border-amber-100 bg-amber-50/60" />
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policies" aria-label="Search policies" className={`${field} w-56`} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={`${field} w-40`}>
            <option value="">All statuses</option><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={`${field} w-52`}>
            <option value="">All categories</option>{data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setCreating(true)} disabled={!data} className="ml-auto rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">New policy</button>
        </div>

        <div className="overflow-x-auto border-t border-indigo-50">
          {!data && !error ? (
            <div className="space-y-2 p-6" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>
          ) : rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">{(data?.documents.length ?? 0) === 0 ? "No policies yet. Click New policy to add the first one." : "No policies match these filters."}</p>
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">Policy</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Created by</th>
                  <th className="px-4 py-3">Published</th><th className="px-4 py-3">Effective</th><th className="px-4 py-3">Audience</th><th className="px-4 py-3">Acknowledged</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t border-indigo-50 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/policies/${d.id}`} className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">{d.title}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {d.openNotes > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{d.openNotes} review note{d.openNotes === 1 ? "" : "s"} open</span>}
                        {d.hasPendingVersion && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">new version waiting</span>}
                        {!d.isMandatory && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">optional</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.category}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{d.versionLabel}</td>
                    <td className="px-4 py-3 text-slate-600">{d.createdBy ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(d.publishedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(d.effectiveDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{d.audienceLabel}<span className="block text-xs text-slate-400">{d.audience} {d.audience === 1 ? "person" : "people"}</span></td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {d.status === "PUBLISHED" ? <>{d.accepted} of {d.audience}<span className="block text-xs text-slate-400">{d.audience ? Math.round((d.accepted / d.audience) * 100) : 0}%</span></> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[d.status]}`}>{STATUS_LABEL[d.status]}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={`/dashboard/policies/${d.id}`} className="rounded-lg border border-indigo-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Open</Link>{" "}
                      {d.status === "ARCHIVED" ? (
                        <button disabled={busy === d.id} onClick={() => toggle(d.id, false)} className="rounded-lg border border-indigo-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Restore</button>
                      ) : (
                        <button disabled={busy === d.id} onClick={() => toggle(d.id, true)} className="rounded-lg border border-indigo-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Archive</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {creating && data && (
        <PolicyForm mode="create" setup={data} onClose={() => setCreating(false)} onDone={(id, message) => { setCreating(false); setNotice(message); bump(); router.push(`/dashboard/policies/${id}`); }} />
      )}
    </div>
  );
}
