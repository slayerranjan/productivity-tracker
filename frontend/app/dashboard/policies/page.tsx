"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, apiGet, apiPost, getToken } from "@/lib/api";
import { useMe } from "../layout";
import { Modal } from "../_employees/Modal";

// ---------------------------------------------------------------------------
// POLICIES & INDUCTION
// Everyone: open each document and confirm they have read it.
// HR / Admin: upload documents, see who has accepted, replace a file (people
// must accept the new version), archive.
// ---------------------------------------------------------------------------

type Doc = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  isMandatory: boolean;
  version: number;
  fileName: string;
  opened: boolean;
  acknowledgedAt: string | null;
};
type Mine = { documents: Doc[]; pendingMandatory: number };
type Managed = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  isMandatory: boolean;
  isActive: boolean;
  version: number;
  fileName: string;
  team: { id: string; name: string } | null;
  audience: number;
  accepted: number;
};
type Manage = { teams: { id: string; name: string }[]; documents: Managed[] };
type Report = { document: { title: string; version: number }; people: { id: string; name: string; employeeCode: string | null; designation: string | null; openedAt: string | null; acknowledgedAt: string | null }[] };

const CATEGORY: Record<string, string> = {
  COMPANY_OVERVIEW: "Company overview",
  PROBATION_POLICY: "Probation policy",
  LEAVE_POLICY: "Leave policy",
  CODE_OF_CONDUCT: "Code of conduct",
  IT_POLICY: "IT policy",
  ROLE_TRAINING: "Role training",
  OTHER: "Other",
};

const when = (s: string) => new Date(s).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });

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

// The file is private, so it is fetched with the login token and shown from memory.
async function openDocument(id: string) {
  const res = await fetch(`${API_BASE}/policies/${id}/file`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not open the file");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file"));
    r.readAsDataURL(file);
  });

export default function PoliciesPage() {
  const me = useMe();
  const isHr = me?.role === "HR" || me?.role === "ADMIN";
  const [tab, setTab] = useState<"read" | "manage">("read");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const mine = useApi<Mine>("/policies", reload);
  const manage = useApi<Manage>(isHr && tab === "manage" ? "/policies/manage" : null, reload);
  const report = useApi<Report>(reportFor ? `/policies/${reportFor}/report` : null, reload);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function replace(file: File | undefined) {
    const id = replaceFor;
    setReplaceFor(null);
    if (!file || !id) return;
    await run("replace" + id, async () => apiPost(`/policies/${id}/file`, { fileName: file.name, data: await readFile(file), mimeType: file.type }), "File replaced. Everyone will be asked to accept the new version.");
  }

  const card = "rounded-2xl bg-white shadow-[var(--shadow-card)]";

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Policies &amp; induction</h1>
          <p className="mt-1 text-sm text-slate-500">Open each document, then confirm you have read it. Your confirmation is kept on record.</p>
        </div>
        {isHr && tab === "manage" && (
          <button onClick={() => setAdding(true)} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
            Add document
          </button>
        )}
      </div>

      {isHr && (
        <div className="flex gap-2">
          {([["read", "My reading list"], ["manage", "Manage documents"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setNotice(""); setError(""); }} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-indigo-50"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <input ref={fileInput} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = ""; }} />

      {tab === "read" && (
        <section className={`${card} p-6`}>
          {mine.data && mine.data.pendingMandatory > 0 && (
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {mine.data.pendingMandatory} required {mine.data.pendingMandatory === 1 ? "document is" : "documents are"} waiting for you.
            </p>
          )}
          {mine.error && <p className="text-sm text-red-600">{mine.error}</p>}
          {mine.data && mine.data.documents.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">There is nothing to read yet.</p>}
          <div className="divide-y divide-indigo-100">
            {mine.data?.documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {d.title}
                    {d.isMandatory && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">Required</span>}
                    {d.version > 1 && <span className="ml-2 text-xs font-normal text-slate-400">version {d.version}</span>}
                  </p>
                  <p className="text-sm text-slate-500">{CATEGORY[d.category] ?? d.category}{d.description ? ` · ${d.description}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  {d.acknowledgedAt ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Accepted {when(d.acknowledgedAt)}</span>
                  ) : (
                    <button
                      disabled={!d.opened || busy === "ack" + d.id}
                      title={d.opened ? "" : "Open the document first"}
                      onClick={() => run("ack" + d.id, () => apiPost(`/policies/${d.id}/acknowledge`), "Thank you. Your confirmation is recorded.")}
                      className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      I have read this
                    </button>
                  )}
                  <button
                    disabled={busy === "open" + d.id}
                    onClick={() => run("open" + d.id, () => openDocument(d.id))}
                    className="rounded-lg border border-indigo-100 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "manage" && isHr && (
        <section className={`${card} p-6`}>
          {manage.error && <p className="text-sm text-red-600">{manage.error}</p>}
          {manage.data && manage.data.documents.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No documents yet. Add the first one.</p>}
          <div className="divide-y divide-indigo-100">
            {manage.data?.documents.map((d) => (
              <div key={d.id} className={`flex flex-wrap items-center justify-between gap-3 py-4 ${d.isActive ? "" : "opacity-60"}`}>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {d.title} <span className="text-xs font-normal text-slate-400">version {d.version}</span>
                    {!d.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Archived</span>}
                  </p>
                  <p className="text-sm text-slate-500">
                    {CATEGORY[d.category]} · {d.team ? `Team: ${d.team.name}` : "Whole company"} · {d.isMandatory ? "Required" : "Optional"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                    {d.accepted} of {d.audience} accepted
                  </span>
                  <button onClick={() => setReportFor(d.id)} className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Who accepted</button>
                  <button onClick={() => run("open" + d.id, () => openDocument(d.id))} className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Open</button>
                  <button onClick={() => { setReplaceFor(d.id); fileInput.current?.click(); }} className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Replace file</button>
                  <button
                    disabled={busy === "arch" + d.id}
                    onClick={() => run("arch" + d.id, () => apiPost(`/policies/${d.id}/${d.isActive ? "archive" : "restore"}`), d.isActive ? "Archived. Employees no longer see it." : "Restored.")}
                    className="rounded-lg border border-indigo-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {d.isActive ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {adding && manage.data && (
        <AddModal
          teams={manage.data.teams}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setNotice("Document added.");
            setReload((n) => n + 1);
          }}
        />
      )}

      {reportFor && (
        <Modal title={report.data?.document.title ?? "Who accepted"} subtitle={report.data ? `Current version ${report.data.document.version}` : undefined} onClose={() => setReportFor(null)} width="max-w-2xl">
          {report.error && <p className="text-sm text-red-600">{report.error}</p>}
          {report.data && (
            <div className="divide-y divide-indigo-100 rounded-2xl border border-indigo-100">
              {report.data.people.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-slate-800">
                    {p.name} <span className="text-xs text-slate-400">{p.employeeCode}</span>
                  </span>
                  {p.acknowledgedAt ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Accepted {when(p.acknowledgedAt)}</span>
                  ) : p.openedAt ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">Opened, not accepted</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">Not opened</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function AddModal({ teams, onClose, onDone }: { teams: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState("CODE_OF_CONDUCT");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [teamId, setTeamId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !file) return;
    setBusy(true);
    setError("");
    try {
      await apiPost("/policies", { category, title, description, isMandatory: mandatory, teamId: teamId || null, fileName: file.name, data: await readFile(file), mimeType: file.type });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2.5 text-sm text-slate-800";
  return (
    <Modal
      title="Add document"
      subtitle="PDF, image or Word file, up to 10 MB"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button>
          <button disabled={busy || !file || title.trim().length < 2} onClick={submit} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Uploading…" : "Add document"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm text-slate-600">
          Type
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block text-sm text-slate-600">
          Title
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>
        <label className="block text-sm text-slate-600">
          Short description (optional)
          <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} className={input} />
        </label>
        <label className="block text-sm text-slate-600">
          Who must read it
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={input}>
            <option value="">Whole company</option>
            {teams.map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Required (people must confirm they have read it)
        </label>
        <label className="block text-sm text-slate-600">
          File
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
        </label>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
