"use client";

import { useCallback, useState } from "react";
import { usePolicyRealtime } from "@/lib/realtime";
import { useMe } from "../layout";
import ReadTab from "./_components/ReadTab";
import ManageTab from "./_components/ManageTab";
import TrackingTab from "./_components/TrackingTab";
import { useFallbackPoll } from "./_lib";

// ---------------------------------------------------------------------------
// POLICIES & INDUCTION
// Everyone: the published policies meant for them, to read and confirm.
// HR / Admin also get "Manage policies" (drafts, publishing, versions) and "Acknowledgments" (who has confirmed).
// The page updates by itself when HR publishes or someone confirms (live connection); if that connection is down
// it re-checks every 30 seconds instead.
// ---------------------------------------------------------------------------

type Tab = "read" | "manage" | "tracking";

export default function PoliciesPage() {
  const me = useMe();
  const isHr = me?.role === "HR" || me?.role === "ADMIN";
  const [tab, setTab] = useState<Tab>("read");
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const bump = useCallback(() => setReload((n) => n + 1), []);

  const { connected } = usePolicyRealtime(bump);
  useFallbackPoll(connected, bump);

  const tabs: [Tab, string][] = isHr ? [["read", "Policies to read"], ["manage", "Manage policies"], ["tracking", "Acknowledgments"]] : [["read", "Policies to read"]];

  return (
    <div className="mx-auto page-7xl space-y-5 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Policies &amp; induction</h1>
          <p className="mt-1 text-sm text-slate-500">Read each policy, then confirm you have read and understood it. Your confirmation is kept on record.</p>
        </div>
        <p className={"inline-flex items-center gap-1.5 text-xs " + (connected ? "text-emerald-600" : "text-amber-600")} aria-live="polite">
          <span className={"h-1.5 w-1.5 rounded-full " + (connected ? "bg-emerald-500" : "bg-amber-400")} />
          {connected ? "Live: updates appear as they happen" : "Reconnecting… checking every 30 seconds"}
        </p>
      </div>

      {tabs.length > 1 && (
        <div role="tablist" className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-[var(--shadow-card)]">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setNotice(""); }}
              className={"rounded-lg px-4 py-2 text-sm font-medium " + (tab === key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50")}>
              {label}
            </button>
          ))}
        </div>
      )}

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">{notice}</p>}

      {tab === "read" && <ReadTab reload={reload} />}
      {tab === "manage" && isHr && <ManageTab reload={reload} bump={bump} setNotice={setNotice} />}
      {tab === "tracking" && isHr && <TrackingTab reload={reload} />}
    </div>
  );
}
