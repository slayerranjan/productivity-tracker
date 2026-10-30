"use client";

import Link from "next/link";
import { useState } from "react";
import { card, fmtDate, fmtDateTime, STATUS_CHIP, STATUS_LABEL, useApi, type History, type ListItem, type Mine } from "../_lib";

// What an employee sees: the published policies meant for them, with filters and their own confirmation history.

type Filter = "all" | "pending" | "done" | "induction";

export default function ReadTab({ reload }: { reload: number }) {
  const mine = useApi<Mine>("/policies", reload);
  const hist = useApi<History>("/policies/history", reload);
  const [filter, setFilter] = useState<Filter>("all");
  const [showHistory, setShowHistory] = useState(false);

  const docs = mine.data?.documents ?? [];
  const counts = {
    all: docs.length,
    pending: docs.filter((d) => d.status === "PENDING").length,
    done: docs.filter((d) => d.status === "ACKNOWLEDGED").length,
    induction: docs.filter((d) => d.isInduction).length,
  };
  const shown = docs.filter((d) => (filter === "all" ? true : filter === "pending" ? d.status === "PENDING" : filter === "done" ? d.status === "ACKNOWLEDGED" : d.isInduction));
  const FILTERS: [Filter, string][] = [["all", "All policies"], ["pending", "Pending acknowledgment"], ["done", "Acknowledged"], ["induction", "Induction documents"]];

  return (
    <div className="space-y-5">
      {mine.data && counts.pending > 0 && (
        <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <span><b>{counts.pending}</b> {counts.pending === 1 ? "policy needs" : "policies need"} your confirmation.</span>
          <button onClick={() => setFilter("pending")} className="rounded-lg border border-amber-200 px-3 py-1 text-xs font-medium hover:bg-amber-100">Show them</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter policies">
        {FILTERS.map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${filter === key ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-100 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {label} <span className={filter === key ? "text-indigo-200" : "text-slate-400"}>{counts[key]}</span>
          </button>
        ))}
      </div>

      {mine.error && !mine.data && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t load the policies: {mine.error}</p>}
      {!mine.data && !mine.error && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>}

      {mine.data && shown.length === 0 && (
        <div className={`${card} px-6 py-12 text-center text-sm text-slate-500`}>
          {docs.length === 0 ? "There is nothing to read yet. When HR publishes a policy for you, it appears here." : "No policies match this filter."}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((d) => <PolicyCard key={d.id} d={d} />)}
      </div>

      <section className={card}>
        <button onClick={() => setShowHistory((o) => !o)} aria-expanded={showHistory} className="flex w-full items-center justify-between px-6 py-4 text-left">
          <span className="text-sm font-semibold text-slate-900">My acknowledgment history</span>
          <span className="text-xs text-slate-500">{hist.data ? `${hist.data.records.length} on record` : ""} {showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <div className="border-t border-indigo-50 px-6 py-4">
            {hist.data && hist.data.records.length === 0 && <p className="text-sm text-slate-500">You have not confirmed any policy yet.</p>}
            <ul className="divide-y divide-indigo-50 text-sm">
              {hist.data?.records.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><Link href={`/dashboard/policies/${r.policyId}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link> <span className="text-slate-400">· {r.category} · version {r.versionLabel}</span></span>
                  <span className="text-xs text-slate-500">Confirmed {fmtDateTime(r.acknowledgedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function PolicyCard({ d }: { d: ListItem }) {
  return (
    <Link href={`/dashboard/policies/${d.id}`} className={`${card} group flex flex-col p-5 transition hover:ring-2 hover:ring-indigo-100`}>
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">{d.category}</span>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[d.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900 group-hover:text-indigo-700">{d.title}</h3>
      <p className="mt-1 line-clamp-3 flex-1 text-sm text-slate-500">{d.description || "No description."}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
        <div><dt className="text-slate-400">Version</dt><dd className="font-medium text-slate-700">{d.versionLabel}</dd></div>
        <div><dt className="text-slate-400">Acknowledgment</dt><dd className="font-medium text-slate-700">{d.isMandatory ? "Mandatory" : "Optional"}</dd></div>
        <div><dt className="text-slate-400">Published</dt><dd className="font-medium text-slate-700">{fmtDate(d.publishedAt)}</dd></div>
        <div><dt className="text-slate-400">Effective</dt><dd className="font-medium text-slate-700">{fmtDate(d.effectiveDate)}</dd></div>
      </dl>
      {d.acknowledgedAt && <p className="mt-3 text-xs text-emerald-700">Confirmed {fmtDate(d.acknowledgedAt)}</p>}
      <span className="mt-4 text-sm font-medium text-indigo-600">{d.status === "PENDING" ? "Read and confirm →" : "Read →"}</span>
    </Link>
  );
}
