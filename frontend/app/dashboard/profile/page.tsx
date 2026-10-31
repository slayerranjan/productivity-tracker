"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useMe } from "../layout";
import { MyDocuments } from "../_documents/MyDocuments";

// ---------------------------------------------------------------------------
// MY PROFILE
// Everything about me in one place: who I am, my offer letter, my documents
// and every payslip. Read-only — nothing here can change my own record.
//
// Each section loads independently and fails independently. A missing offer
// or an unpublished payslip must not blank the whole page.
// ---------------------------------------------------------------------------

type Offer = {
  id: string;
  status: string;
  roleTitle: string;
  joiningDate: string;
  html: string;
  respondedAt: string | null;
};

type Slip = {
  id: string;
  month?: number;
  year?: number;
  fileName?: string | null;
  publishedAt?: string | null;
  netAmount?: string | null;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  HR: "HR",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ProfilePage() {
  const me = useMe();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [slips, setSlips] = useState<Slip[]>([]);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [showLetter, setShowLetter] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const problems: string[] = [];

    // --- offer letter
    try {
      const res = await apiGet<{ offer: Offer | null }>("/offers/me");
      setOffer(res?.offer ?? null);
    } catch {
      problems.push("Could not load your offer letter.");
    }

    // --- payslips. Shape varies, so accept either an array or a wrapper.
    try {
      const res = await apiGet<unknown>("/payroll/me");
      const list = Array.isArray(res)
        ? res
        : ((res as { slips?: Slip[]; rows?: Slip[] })?.slips ??
           (res as { rows?: Slip[] })?.rows ??
           []);
      setSlips(Array.isArray(list) ? (list as Slip[]) : []);
    } catch {
      problems.push("Could not load your payslips.");
    }

    // --- documents, count only. The detail lives on the onboarding screen.
    try {
      const res = await apiGet<unknown>("/onboarding/me");
      const docs = (res as { documents?: unknown[] })?.documents;
      setDocCount(Array.isArray(docs) ? docs.length : null);
    } catch {
      setDocCount(null);
    }

    setNotes(problems);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!me) return null;

  const fullName = `${me.firstName} ${me.lastName}`.trim();
  const published = slips.filter((s) => s.publishedAt !== null);

  return (
    <div className="p-8 page-4xl">
      {/* ---- identity ---- */}
      <section className="mb-6 overflow-hidden rounded-2xl bg-indigo-600">
        <div className="flex flex-col gap-5 p-7 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-bold text-white">
            {initials(fullName)}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-white">{fullName}</h1>
            <p className="mt-0.5 text-sm text-indigo-100">
              {me.designation ?? "No designation set"}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
                {me.platform.name}
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
                {ROLE_LABEL[me.role] ?? me.role}
              </span>
              {me.employeeCode && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
                  ID {me.employeeCode}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/5 sm:grid-cols-4">
          {[
            { label: "Sign in with", value: me.employeeCode ?? me.email },
            { label: "Payslips", value: String(published.length) },
            {
              label: "Documents",
              value: docCount === null ? "—" : String(docCount),
            },
            {
              label: "Tracker",
              value: me.trackerAccessEnabled ? "Open" : "Locked",
            },
          ].map((cell) => (
            <div key={cell.label} className="bg-indigo-600 px-5 py-3.5">
              <p className="text-[11px] text-indigo-200">{cell.label}</p>
              <p className="mt-0.5 truncate text-sm font-medium text-white">
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {notes.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {notes.join(" ")}
        </div>
      )}

      {/* ---- offer letter ---- */}
      <section className="mb-6 overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-indigo-50 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Offer letter
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {offer
                ? `${offer.roleTitle} · joining ${offer.joiningDate}`
                : "Nothing on file"}
            </p>
          </div>

          {offer && (
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  offer.status === "ACCEPTED"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {offer.status.toLowerCase()}
              </span>
              <button
                onClick={() => setShowLetter((v) => !v)}
                className="rounded-xl border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-indigo-50/60"
              >
                {showLetter ? "Hide" : "Read"}
              </button>
              {showLetter && (
                <button
                  onClick={() => window.print()}
                  className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  Save as PDF
                </button>
              )}
            </div>
          )}
        </div>

        {offer && showLetter && (
          // The letter is HTML the system generated from HR's template, so
          // rendering it is safe. Print styles strip the sidebar, which is
          // what makes "Save as PDF" produce a clean document.
          <div
            className="prose prose-sm max-w-none px-7 py-6 text-slate-800 [&_p]:mb-3 [&_strong]:text-slate-900"
            dangerouslySetInnerHTML={{ __html: offer.html }}
          />
        )}

        {!offer && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            Your offer letter will appear here once HR issues it.
          </p>
        )}
      </section>

      {/* ---- documents: upload here, HR reviews ---- */}
      <div className="mb-6 no-print">
        <MyDocuments />
      </div>

      {/* ---- payslips: a pointer, not a second list ---- */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)] no-print">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Payslips</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {published.length === 0
                ? "None published yet"
                : `${published.length} available to download`}
            </p>
          </div>
          {published.length > 0 && (
            <a
              href="/dashboard/payslips"
              className="shrink-0 rounded-xl border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-indigo-50/60"
            >
              Open payslips
            </a>
          )}
        </div>
      </section>
    </div>
  );
}