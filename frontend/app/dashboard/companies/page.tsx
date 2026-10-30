"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useMe } from "../layout";
import { Modal } from "../_employees/Modal";

// ---------------------------------------------------------------------------
// COMPANIES (HR and Admin only)
// The companies that exist in Avatar HRMS. Employee numbers are shown only for
// your own company. HR can edit their own company, Admin can edit any. The
// server enforces all of this; this page only hides what you cannot use.
// ---------------------------------------------------------------------------

type Company = {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  timezone: string;
  employeeCodePrefix: string | null;
  isActive: boolean;
  isYours: boolean;
  isPinned: boolean;
  employees: number | null;
  canEdit: boolean;
};
type Data = { pinnedTo: { id: string; name: string } | null; canCreate: boolean; companies: Company[] };

function useData(reload: number, enabled: boolean) {
  const [res, setRes] = useState<{ data?: Data; error?: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    apiGet<Data>("/companies")
      .then((data) => live && setRes({ data }))
      .catch((e: Error) => live && setRes((p) => ({ data: p?.data, error: e.message })));
    return () => {
      live = false;
    };
  }, [reload, enabled]);
  return { data: res?.data ?? null, error: res?.error ?? "" };
}

export default function CompaniesPage() {
  const me = useMe();
  const allowed = me?.role === "HR" || me?.role === "ADMIN";
  const [reload, setReload] = useState(0);
  const { data, error } = useData(reload, allowed);
  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const [notice, setNotice] = useState("");

  if (me && !allowed) {
    return (
      <div className="p-8">
        <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-[var(--shadow-card)]">Company management is only available to HR and Admin.</p>
      </div>
    );
  }

  const card = "rounded-2xl bg-white shadow-[var(--shadow-card)]";
  return (
    <div className="page-fluid space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Companies</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data?.pinnedTo ? `This Avatar HRMS is set up for ${data.pinnedTo.name}. Other companies are listed here but their people are not shown.` : "The companies in Avatar HRMS."}
          </p>
        </div>
        <button onClick={() => setEditing("new")} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
          Add company
        </button>
      </div>

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <section className={`${card} p-6`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-400">
                <th className="py-2 font-medium">Company</th>
                <th className="py-2 font-medium">Code prefix</th>
                <th className="py-2 font-medium">Timezone</th>
                <th className="py-2 text-right font-medium">Employees</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-100">
              {data?.companies.map((c) => (
                <tr key={c.id} className={c.isActive ? "" : "opacity-60"}>
                  <td className="py-3">
                    <p className="font-medium text-slate-900">
                      {c.name}
                      {c.isYours && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">Your company</span>}
                    </p>
                    {c.legalName && <p className="text-xs text-slate-400">{c.legalName}</p>}
                  </td>
                  <td className="py-3 text-slate-600">{c.employeeCodePrefix ?? "–"}</td>
                  <td className="py-3 text-slate-600">{c.timezone}</td>
                  <td className="py-3 text-right tabular-nums text-slate-600">{c.employees ?? "–"}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="py-3 text-right">
                    {c.canEdit && (
                      <button onClick={() => setEditing(c)} className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <CompanyModal
          company={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setNotice(text);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function CompanyModal({ company, onClose, onDone }: { company: Company | null; onClose: () => void; onDone: (text: string) => void }) {
  const [name, setName] = useState(company?.name ?? "");
  const [legalName, setLegalName] = useState(company?.legalName ?? "");
  const [timezone, setTimezone] = useState(company?.timezone ?? "Asia/Kolkata");
  const [prefix, setPrefix] = useState(company?.employeeCodePrefix ?? "");
  const [active, setActive] = useState(company?.isActive ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The server refuses to deactivate your own or the pinned company; the switch just does not offer it.
  const canToggle = company !== null && !company.isYours && !company.isPinned;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { name, legalName, timezone, employeeCodePrefix: prefix };
      if (company) {
        await apiPost(`/companies/${company.id}`, { ...body, ...(canToggle ? { isActive: active } : {}) });
        onDone("Company updated.");
      } else {
        await apiPost("/companies", body);
        onDone("Company added. It starts empty; add its HR or Admin from Employees.");
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2.5 text-sm text-slate-800";
  return (
    <Modal
      title={company ? "Edit company" : "Add company"}
      subtitle={company ? undefined : "Creates the company record only. No people are added."}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button>
          <button disabled={busy || name.trim().length < 2} onClick={save} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm text-slate-600">
          Company name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block text-sm text-slate-600">
          Legal name (optional)
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-slate-600">
            Employee code prefix
            <input value={prefix} maxLength={8} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="e.g. AVT" className={input} />
          </label>
          <label className="block text-sm text-slate-600">
            Timezone
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={input} />
          </label>
        </div>
        <p className="text-xs text-slate-400">The prefix only affects new employee codes. The timezone decides what &ldquo;today&rdquo; means for attendance, so change it with care.</p>
        {company && (
          <label className={`flex items-center gap-2 text-sm ${canToggle ? "text-slate-600" : "text-slate-300"}`}>
            <input type="checkbox" checked={active} disabled={!canToggle} onChange={(e) => setActive(e.target.checked)} /> Active (an inactive company is closed to everyone in it)
          </label>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
