"use client";

import { useState } from "react";
import { apiPatch, apiPost } from "@/lib/api";
import { Modal } from "../../_employees/Modal";
import { field, readFile, useCompany, withCompany, type Detail, type Manage } from "../_lib";

// One form, three jobs:
//   create  - a new policy, saved as a DRAFT (nothing is visible to employees until HR publishes it)
//   edit    - change a draft (its details, audience, or file)
//   version - a new version of a PUBLISHED policy (kept beside the live one until HR publishes it)

type Mode = "create" | "edit" | "version";
type Setup = Pick<Manage, "teams" | "categories" | "employmentTypes" | "roles">;

const TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", PROBATION: "Probation", CONTRACT: "Contract", INTERN: "Intern" };
const ROLE_LABEL: Record<string, string> = { EMPLOYEE: "Employees", MANAGER: "Managers", HR: "HR", ADMIN: "Admins" };

export default function PolicyForm({ mode, setup, policy, onClose, onDone }: { mode: Mode; setup: Setup; policy?: Detail; onClose: () => void; onDone: (id: string, message: string) => void }) {
  const co = useCompany();
  const hr = policy?.hr;
  const [title, setTitle] = useState(policy?.title ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [category, setCategory] = useState(policy?.category ?? "Human Resource Policy");
  const [label, setLabel] = useState(mode === "version" ? "" : (policy?.versionLabel ?? "1.0"));
  const [effective, setEffective] = useState(policy?.effectiveDate ?? "");
  const [mandatory, setMandatory] = useState(policy?.isMandatory ?? true);
  const [allowDownload, setAllowDownload] = useState(policy?.allowDownload ?? true);
  const [everyone, setEveryone] = useState(hr ? hr.audience.everyone : true);
  const [teams, setTeams] = useState<string[]>(hr?.audience.teamIds ?? []);
  const [types, setTypes] = useState<string[]>(hr?.audience.employmentTypes ?? []);
  const [roles, setRoles] = useState<string[]>(hr?.audience.roles ?? []);
  const [note, setNote] = useState("");
  const [requiresAck, setRequiresAck] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [categories, setCategories] = useState(setup.categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const res = await apiPost<{ categories: string[] }>(withCompany("/policies/categories", co), { name });
      setCategories(res.categories);
      setCategory(name);
      setNewCategory("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (busy) return;
    setError("");
    if (mode !== "version" && title.trim().length < 2) return setError("Give the policy a title.");
    if (mode !== "edit" && !file) return setError("Attach the policy file (PDF or Word).");
    if (mode !== "version" && !everyone && teams.length + types.length + roles.length === 0) return setError("Choose who the policy is for, or pick all employees.");
    setBusy(true);
    try {
      const upload = file ? { fileName: file.name, data: await readFile(file), mimeType: file.type } : {};
      const audience = everyone ? { teamIds: [], employmentTypes: [], roles: [] } : { teamIds: teams, employmentTypes: types, roles };
      if (mode === "create") {
        const res = await apiPost<{ id: string }>(withCompany("/policies", co), { ...upload, title, description, category, versionLabel: label, effectiveDate: effective || null, isMandatory: mandatory, allowDownload, audience });
        onDone(res.id, "Saved as a draft. Employees cannot see it until you publish it.");
      } else if (mode === "edit" && policy) {
        await apiPatch(withCompany(`/policies/${policy.id}`, co), { ...upload, title, description, category, versionLabel: label, effectiveDate: effective || null, isMandatory: mandatory, allowDownload, audience });
        onDone(policy.id, "Draft saved.");
      } else if (policy) {
        await apiPost(withCompany(`/policies/${policy.id}/versions`, co), { ...upload, versionLabel: label, changeNote: note, requiresAck });
        onDone(policy.id, "New version saved. It stays unpublished until you publish it; employees still see the current version.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "create" ? "New policy" : mode === "edit" ? "Edit draft" : "New version";
  const sub = mode === "version" ? `Version of "${policy?.title}". The current version stays live until you publish this one.` : "Saved as a draft. Nothing is shown to employees until you publish.";

  return (
    <Modal title={heading} subtitle={sub} onClose={onClose} width="max-w-2xl" footer={
      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-indigo-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "Saving…" : mode === "version" ? "Save new version" : "Save as draft"}</button>
      </div>
    }>
      <div className="space-y-4">
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {mode !== "version" && (
          <>
            <label className="block text-sm text-slate-600">Policy title
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${field} mt-1`} placeholder="e.g. Human Resource Policy" />
            </label>
            <label className="block text-sm text-slate-600">Short description (shown on the policy card)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className={`${field} mt-1`} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-600">Category
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} mt-1`}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block text-sm text-slate-600">Add a category
                <div className="mt-1 flex gap-2">
                  <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={60} className={field} placeholder="New category" />
                  <button type="button" onClick={addCategory} disabled={!newCategory.trim()} className="rounded-xl border border-indigo-100 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Add</button>
                </div>
              </label>
            </div>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-600">Version number
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} className={`${field} mt-1`} placeholder={mode === "version" ? "e.g. 1.1" : "1.0"} />
          </label>
          {mode !== "version" && (
            <label className="block text-sm text-slate-600">Effective date
              <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={`${field} mt-1`} />
              <span className="mt-1 block text-xs text-slate-400">Leave empty to use the day you publish.</span>
            </label>
          )}
        </div>

        {mode === "version" && (
          <>
            <label className="block text-sm text-slate-600">What changed (optional)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={`${field} mt-1`} />
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} className="mt-0.5" />
              <span>Employees must read and confirm this new version again<span className="block text-xs text-slate-400">Untick for a small correction that needs no new confirmation. Earlier confirmations are always kept.</span></span>
            </label>
          </>
        )}

        {mode !== "version" && (
          <>
            <fieldset className="space-y-2 rounded-xl border border-indigo-100 p-3">
              <legend className="px-1 text-sm font-medium text-slate-700">Who is it for?</legend>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> All employees of the company</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Only people who match any of these</label>
              {!everyone && (
                <div className="space-y-3 pl-6 text-sm">
                  <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Teams (departments)</p>
                    <div className="flex flex-wrap gap-2">{setup.teams.map((t) => <Chip key={t.id} on={teams.includes(t.id)} onClick={() => toggle(teams, setTeams, t.id)}>{t.name}</Chip>)}{setup.teams.length === 0 && <span className="text-xs text-slate-400">No teams yet</span>}</div></div>
                  <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Employment category</p>
                    <div className="flex flex-wrap gap-2">{setup.employmentTypes.map((t) => <Chip key={t} on={types.includes(t)} onClick={() => toggle(types, setTypes, t)}>{TYPE_LABEL[t] ?? t}</Chip>)}</div></div>
                  <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Roles</p>
                    <div className="flex flex-wrap gap-2">{setup.roles.map((r) => <Chip key={r} on={roles.includes(r)} onClick={() => toggle(roles, setRoles, r)}>{ROLE_LABEL[r] ?? r}</Chip>)}</div></div>
                </div>
              )}
            </fieldset>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="mt-0.5" />
              <span>Employees must confirm they have read it<span className="block text-xs text-slate-400">HR sees who has and has not confirmed.</span></span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} /> Employees may download the original file</label>
          </>
        )}

        <label className="block text-sm text-slate-600">{mode === "edit" ? "Replace the file (optional)" : "Policy file"} — PDF or Word, up to 10 MB
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700" />
          {mode === "edit" && policy && !file && <span className="mt-1 block text-xs text-slate-400">Current file: {policy.fileName}</span>}
        </label>
      </div>
    </Modal>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-indigo-100 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {children}
    </button>
  );
}
