"use client";

import { useMe } from "../layout";
import HuddleOverview from "../_standup/HuddleOverview";

// Team Huddle (managers): today's huddles you run, who joined, and each reporting employee's productive-time breakdown.
export default function HuddlesPage() {
  const me = useMe();
  if (!me) return null;
  if (me.role !== "MANAGER") {
    return (
      <div className="page-4xl p-4 sm:p-8">
        <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-[var(--shadow-card)]">This page is for managers. Schedule or join a huddle from <b>Meetings</b>. HR and Admin see participation counts there.</p>
      </div>
    );
  }
  return (
    <div className="page-5xl space-y-5 p-4 sm:p-8">
      <header>
        <p className="text-sm text-slate-400">People who report to you</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">Team Huddle</h1>
      </header>
      <HuddleOverview />
    </div>
  );
}
