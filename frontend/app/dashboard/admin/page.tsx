// ===========================================================================
// ADMIN — People, Teams, Shifts, Thresholds, Leave
//
// Five tabs, one page. Add and edit happen in a slide-over panel rather than
// a separate route, so the list stays visible behind it and you don't lose
// your place in a long table.
//
// Options for every dropdown come from a single /admin/options call made
// once when the page mounts, instead of each form fetching its own lists.
// ===========================================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import { useMe } from "../layout";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001/api";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${
        typeof window === "undefined" ? "" : localStorage.getItem("token") ?? ""
      }`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "That didn't work");
  return data as T;
}

// --- types -----------------------------------------------------------------

type Options = {
  teams: { id: string; name: string }[];
  shifts: { id: string; name: string; startTime: string; endTime: string; isDefault: boolean }[];
  managers: { id: string; name: string; role: string }[];
  roles: string[];
  statuses: string[];
  onboardingStatuses: string[];
  teamTypes: string[];
  leaveTypes: string[];
};

type Person = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  role: string;
  status: string;
  designation: string | null;
  dateOfJoining: string | null;
  onboardingStatus: string;
  trackerAccessEnabled: boolean;
  lastLoginAt: string | null;
  shift: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
};

type TeamRow = {
  id: string;
  name: string;
  teamType: string;
  isActive: boolean;
  manager: { id: string; name: string } | null;
  shift: { id: string; name: string; startTime: string; endTime: string } | null;
  config: Record<string, number | string | boolean> | null;
  memberCount: number;
  members: { userId: string; name: string; employeeCode: string | null; role: string }[];
};

type ShiftRow = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workingDays: number[];
  isDefault: boolean;
  isActive: boolean;
  spansMidnight: boolean;
};

type LeaveRow = {
  id: string;
  date: string;
  leaveType: string;
  isHalfDay: boolean;
  isFirstHalf: boolean;
  note: string | null;
  userId: string;
  name: string;
  employeeCode: string | null;
  markedBy: string;
};

const TABS = ["People", "Teams", "Shifts", "Thresholds", "Leave"] as const;
type Tab = (typeof TABS)[number];

const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INVITED: "bg-sky-50 text-sky-700 ring-sky-200",
  CANDIDATE: "bg-slate-50 text-slate-600 ring-slate-200",
  SUSPENDED: "bg-amber-50 text-amber-700 ring-amber-200",
  EXITED: "bg-rose-50 text-rose-700 ring-rose-200",
};

function todayIso() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// ===========================================================================

export default function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("People");
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await call<Options>("/admin/options"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load options");
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  // Clear the confirmation message after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const allowed = me?.role === "ADMIN" || me?.role === "HR";

  if (me && !allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">
            Admin is limited to HR and administrators.
          </p>
        </div>
      </div>
    );
  }

  const shared = {
    options,
    onError: (m: string) => setError(m),
    onDone: (m: string) => {
      setToast(m);
      setError("");
      void loadOptions();
    },
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          People, teams, shifts and the thresholds every alert is measured against.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      {tab === "People" && <PeopleTab {...shared} />}
      {tab === "Teams" && <TeamsTab {...shared} />}
      {tab === "Shifts" && <ShiftsTab {...shared} />}
      {tab === "Thresholds" && <ThresholdsTab {...shared} />}
      {tab === "Leave" && <LeaveTab {...shared} />}
    </div>
  );
}

type TabProps = {
  options: Options | null;
  onError: (m: string) => void;
  onDone: (m: string) => void;
};

// ===========================================================================
// PEOPLE
// ===========================================================================

function PeopleTab({ options, onError, onDone }: TabProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Person | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (role) query.set("role", role);
      const data = await call<{ users: Person[] }>(`/admin/users?${query}`);
      setPeople(data.users);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load people");
    } finally {
      setLoading(false);
    }
    // onError is stable enough for this page; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, role]);

  // Debounced so typing in the search box doesn't fire a request per keypress.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or code…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All roles</option>
          {options?.roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <span className="text-sm text-slate-400">{people.length} people</span>

        <button
          onClick={() => setEditing("new")}
          className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          + Add person
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Shift</th>
              <th className="px-4 py-3">Tracker</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.email}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{p.employeeCode ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{p.role}</td>
                <td className="px-4 py-3 text-slate-600">
                  {p.teams.map((t) => t.name).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.shift?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  {p.trackerAccessEnabled ? (
                    <span className="text-xs text-emerald-700">open</span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      gated · {p.onboardingStatus.toLowerCase().replace(/_/g, " ")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${
                      STATUS_CHIP[p.status] ?? "bg-slate-50 text-slate-600 ring-slate-200"
                    }`}
                  >
                    {p.status.toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditing(p)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Loading…</p>
        )}
        {!loading && people.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nobody matches that.
          </p>
        )}
      </div>

      {editing && (
        <PersonDrawer
          person={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            onDone(msg);
            void load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function PersonDrawer({
  person,
  options,
  onClose,
  onSaved,
  onError,
}: {
  person: Person | null;
  options: Options | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const isNew = person === null;
  const [form, setForm] = useState({
    firstName: person?.firstName ?? "",
    lastName: person?.lastName ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    password: "",
    role: person?.role ?? "EMPLOYEE",
    status: person?.status ?? "INVITED",
    designation: person?.designation ?? "",
    employeeCode: person?.employeeCode ?? "",
    shiftId: person?.shift?.id ?? "",
    teamId: "",
    dateOfJoining: person?.dateOfJoining?.slice(0, 10) ?? "",
    skipOnboarding: false,
    trackerAccessEnabled: person?.trackerAccessEnabled ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const set = (k: keyof typeof form, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v as never }));

  async function save() {
    setBusy(true);
    try {
      if (isNew) {
        await call("/admin/users", "POST", {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone || undefined,
          password: form.password,
          role: form.role,
          designation: form.designation || undefined,
          employeeCode: form.employeeCode || undefined,
          shiftId: form.shiftId || undefined,
          teamId: form.teamId || undefined,
          dateOfJoining: form.dateOfJoining || undefined,
          skipOnboarding: form.skipOnboarding,
        });
        onSaved(`${form.firstName} ${form.lastName} added.`);
      } else {
        await call(`/admin/users/${person!.id}`, "PATCH", {
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          role: form.role,
          status: form.status,
          designation: form.designation,
          employeeCode: form.employeeCode,
          shiftId: form.shiftId || null,
          dateOfJoining: form.dateOfJoining || null,
          trackerAccessEnabled: form.trackerAccessEnabled,
        });
        onSaved(`${form.firstName} ${form.lastName} updated.`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (newPassword.length < 8) {
      onError("The new password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await call(`/admin/users/${person!.id}/password`, "POST", { password: newPassword });
      setNewPassword("");
      onSaved("Password reset.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={isNew ? "Add person" : person!.name} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input value={form.firstName} onChange={(v) => set("firstName", v)} />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={(v) => set("lastName", v)} />
        </Field>
      </div>

      <Field label="Email">
        <Input
          value={form.email}
          onChange={(v) => set("email", v)}
          disabled={!isNew}
          type="email"
        />
      </Field>

      {isNew && (
        <Field label="Temporary password" hint="At least 8 characters. They can change it later.">
          <Input value={form.password} onChange={(v) => set("password", v)} type="text" />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select value={form.role} onChange={(v) => set("role", v)}>
            {options?.roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation">
          <Input value={form.designation} onChange={(v) => set("designation", v)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee code" hint={isNew ? "Leave blank to generate" : undefined}>
          <Input value={form.employeeCode} onChange={(v) => set("employeeCode", v)} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(v) => set("phone", v)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Shift" hint="Late login is measured against this">
          <Select value={form.shiftId} onChange={(v) => set("shiftId", v)}>
            <option value="">No shift</option>
            {options?.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.startTime}–{s.endTime})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date of joining">
          <Input
            value={form.dateOfJoining}
            onChange={(v) => set("dateOfJoining", v)}
            type="date"
          />
        </Field>
      </div>

      {isNew && (
        <>
          <Field label="Add to team">
            <Select value={form.teamId} onChange={(v) => set("teamId", v)}>
              <option value="">No team</option>
              {options?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Toggle
            checked={form.skipOnboarding}
            onChange={(v) => set("skipOnboarding", v)}
            label="Existing employee — skip onboarding"
            hint="Opens the tracker immediately instead of waiting for documents and a resume."
          />
        </>
      )}

      {!isNew && (
        <>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => set("status", v)}>
              {options?.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Toggle
            checked={form.trackerAccessEnabled}
            onChange={(v) => set("trackerAccessEnabled", v)}
            label="Tracker access"
            hint="When off, this person can sign in but cannot clock in."
          />
        </>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? "Saving…" : isNew ? "Create person" : "Save changes"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-400"
        >
          Cancel
        </button>
      </div>

      {!isNew && (
        <div className="mt-6 border-t border-slate-200 pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
            Reset password
          </p>
          <div className="flex gap-2">
            <Input
              value={newPassword}
              onChange={setNewPassword}
              placeholder="New password"
            />
            <button
              onClick={resetPassword}
              disabled={busy || newPassword.length < 8}
              className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ===========================================================================
// TEAMS
// ===========================================================================

function TeamsTab({ options, onError, onDone }: TabProps) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [teamType, setTeamType] = useState("OTHER");
  const [managerId, setManagerId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [addTo, setAddTo] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        call<{ teams: TeamRow[] }>("/admin/teams"),
        call<{ users: Person[] }>("/admin/users"),
      ]);
      setTeams(t.teams);
      setPeople(u.users);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load teams");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    try {
      await call("/admin/teams", "POST", { name, teamType, managerId, shiftId });
      setCreating(false);
      setName("");
      onDone(`Team "${name}" created, with thresholds from the platform defaults.`);
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create the team");
    }
  }

  async function addMember(teamId: string) {
    const userId = addTo[teamId];
    if (!userId) return;
    try {
      await call(`/admin/teams/${teamId}/members`, "POST", { userId });
      setAddTo((s) => ({ ...s, [teamId]: "" }));
      onDone("Member added.");
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add that person");
    }
  }

  async function removeMember(teamId: string, userId: string) {
    try {
      await call(`/admin/teams/${teamId}/members/${userId}`, "DELETE");
      onDone("Member removed.");
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove that person");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New team
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {teams.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-slate-900">{t.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t.teamType.toLowerCase()} · {t.memberCount} member
                  {t.memberCount === 1 ? "" : "s"}
                  {t.shift ? ` · ${t.shift.name}` : ""}
                </p>
              </div>
              {t.manager && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {t.manager.name}
                </span>
              )}
            </div>

            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {t.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-700">
                    {m.name}
                    <span className="ml-2 text-xs text-slate-400">{m.employeeCode}</span>
                  </span>
                  <button
                    onClick={() => removeMember(t.id, m.userId)}
                    className="text-xs text-slate-300 transition hover:text-rose-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {t.members.length === 0 && (
                <li className="py-3 text-sm text-slate-400">No members yet.</li>
              )}
            </ul>

            <div className="mt-3 flex gap-2">
              <select
                value={addTo[t.id] ?? ""}
                onChange={(e) => setAddTo((s) => ({ ...s, [t.id]: e.target.value }))}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="">Add someone…</option>
                {people
                  .filter((p) => !t.members.some((m) => m.userId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => addMember(t.id)}
                disabled={!addTo[t.id]}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Drawer title="New team" onClose={() => setCreating(false)}>
          <Field label="Name">
            <Input value={name} onChange={setName} />
          </Field>
          <Field label="Type">
            <Select value={teamType} onChange={setTeamType}>
              {options?.teamTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Manager">
            <Select value={managerId} onChange={setManagerId}>
              <option value="">None</option>
              {options?.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Shift">
            <Select value={shiftId} onChange={setShiftId}>
              <option value="">None</option>
              {options?.shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <button
            onClick={create}
            disabled={!name.trim()}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            Create team
          </button>
        </Drawer>
      )}
    </div>
  );
}

// ===========================================================================
// SHIFTS
// ===========================================================================

function ShiftsTab({ onError, onDone }: TabProps) {
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [editing, setEditing] = useState<ShiftRow | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setShifts((await call<{ shifts: ShiftRow[] }>("/admin/shifts")).shifts);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load shifts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Late login is measured against each person&apos;s shift, never one global time.
        </p>
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + New shift
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Working days</th>
              <th className="px-4 py-3">Default</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shifts.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">
                  {s.startTime}–{s.endTime}
                  {s.spansMidnight && (
                    <span className="ml-2 text-xs text-slate-400">overnight</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {s.workingDays.map((d) => DAY_LABELS[d]).join(" ")}
                </td>
                <td className="px-4 py-3">
                  {s.isDefault && (
                    <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs text-white">
                      default
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditing(s)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shifts.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">No shifts yet.</p>
        )}
      </div>

      {editing && (
        <ShiftDrawer
          shift={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            onDone(m);
            void load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function ShiftDrawer({
  shift,
  onClose,
  onSaved,
  onError,
}: {
  shift: ShiftRow | null;
  onClose: () => void;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const isNew = shift === null;
  const [name, setName] = useState(shift?.name ?? "");
  const [startTime, setStartTime] = useState(shift?.startTime ?? "10:00");
  const [endTime, setEndTime] = useState(shift?.endTime ?? "19:00");
  const [days, setDays] = useState<number[]>(shift?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const [isDefault, setIsDefault] = useState(shift?.isDefault ?? false);
  const [spansMidnight, setSpansMidnight] = useState(shift?.spansMidnight ?? false);
  const [busy, setBusy] = useState(false);

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  }

  async function save() {
    setBusy(true);
    try {
      const body = { name, startTime, endTime, workingDays: days, isDefault, spansMidnight };
      if (isNew) await call("/admin/shifts", "POST", body);
      else await call(`/admin/shifts/${shift!.id}`, "PATCH", body);
      onSaved(isNew ? `Shift "${name}" created.` : `Shift "${name}" updated.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the shift");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={isNew ? "New shift" : shift!.name} onClose={onClose}>
      <Field label="Name">
        <Input value={name} onChange={setName} placeholder="General 10-7" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input value={startTime} onChange={setStartTime} type="time" />
        </Field>
        <Field label="Ends">
          <Input value={endTime} onChange={setEndTime} type="time" />
        </Field>
      </div>

      <Field label="Working days" hint="Days not selected count as weekly offs.">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                days.includes(d)
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-500 hover:border-slate-400"
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </Field>

      <Toggle
        checked={spansMidnight}
        onChange={setSpansMidnight}
        label="Overnight shift"
        hint="For shifts that end on the following calendar day."
      />
      <Toggle
        checked={isDefault}
        onChange={setIsDefault}
        label="Platform default"
        hint="Setting this removes the default flag from any other shift."
      />

      <button
        onClick={save}
        disabled={busy || !name.trim() || days.length === 0}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
      >
        {busy ? "Saving…" : isNew ? "Create shift" : "Save changes"}
      </button>
    </Drawer>
  );
}

// ===========================================================================
// THRESHOLDS
// ===========================================================================

const THRESHOLD_FIELDS: { key: string; label: string; hint: string; step?: string }[] = [
  { key: "dailyWorkHours", label: "Daily work hours", hint: "Length of the working day", step: "0.5" },
  { key: "productiveHours", label: "Productive target", hint: "Attainment is measured against this", step: "0.5" },
  { key: "breakBudgetMinutes", label: "Break budget (min)", hint: "Total break time allowed per day" },
  { key: "lateLoginGraceMinutes", label: "Late grace (min)", hint: "Minutes after shift start before it counts as late" },
  { key: "breakOverageAlertMinutes", label: "Break overage (min)", hint: "0 alerts the moment the budget is exceeded" },
  { key: "overtimeAlertMinutes", label: "Overtime alert (min)", hint: "Minutes past the working day before alerting" },
  { key: "lowProductivityThreshold", label: "Low productivity", hint: "Fraction of the target, e.g. 0.75", step: "0.05" },
  { key: "biometricToleranceMinutes", label: "Biometric tolerance (min)", hint: "Allowed gap between door and tracker" },
];

function ThresholdsTab({ onError, onDone }: TabProps) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamId, setTeamId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await call<{ teams: TeamRow[] }>("/admin/teams");
      setTeams(data.teams);
      if (!teamId && data.teams[0]) selectTeam(data.teams[0]);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load thresholds");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectTeam(team: TeamRow) {
    setTeamId(team.id);
    const next: Record<string, string> = {};
    for (const f of THRESHOLD_FIELDS) next[f.key] = String(team.config?.[f.key] ?? "");
    next.eodReportTime = String(team.config?.eodReportTime ?? "19:30");
    setDraft(next);
  }

  async function save() {
    setBusy(true);
    try {
      await call(`/admin/config/${teamId}`, "PATCH", draft);
      onDone("Thresholds saved. The alert engine picks them up on its next run, within 15 minutes.");
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const team = teams.find((t) => t.id === teamId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={teamId}
          onChange={(e) => {
            const t = teams.find((x) => x.id === e.target.value);
            if (t) selectTeam(t);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-slate-500">
          Every alert reads these numbers. Nothing is hardcoded.
        </p>
      </div>

      {team && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {THRESHOLD_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Input
                  type="number"
                  step={f.step}
                  value={draft[f.key] ?? ""}
                  onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                />
              </Field>
            ))}
            <Field label="EOD report time" hint="24-hour, platform timezone">
              <Input
                type="time"
                value={draft.eodReportTime ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, eodReportTime: v }))}
              />
            </Field>
          </div>

          <button
            onClick={save}
            disabled={busy}
            className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save thresholds"}
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// LEAVE
// ===========================================================================

function LeaveTab({ options, onError, onDone }: TabProps) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [leaveType, setLeaveType] = useState("PLANNED");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const month = todayIso().slice(0, 7);
      const [l, u] = await Promise.all([
        call<{ leave: LeaveRow[] }>(`/admin/leave?from=${month}-01&to=${todayIso()}`),
        call<{ users: Person[] }>("/admin/users"),
      ]);
      setRows(l.leave);
      setPeople(u.users);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load leave");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mark() {
    setBusy(true);
    try {
      const res = await call<{ marked: number }>("/admin/leave", "POST", {
        userId,
        from,
        to,
        leaveType,
        isHalfDay,
        note,
      });
      setNote("");
      onDone(`${res.marked} day${res.marked === 1 ? "" : "s"} marked as leave.`);
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not mark leave");
    } finally {
      setBusy(false);
    }
  }

  async function unmark(row: LeaveRow) {
    try {
      const date = String(row.date).slice(0, 10);
      await call(`/admin/leave?userId=${row.userId}&date=${date}`, "DELETE");
      onDone("Leave removed.");
      void load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove that leave day");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-sm text-slate-500">
          A leave day removes that day&apos;s target, so approved leave never drags
          attainment down. Absence without leave does.
        </p>

        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Person">
            <Select value={userId} onChange={setUserId}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={setFrom} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={setTo} />
          </Field>
          <Field label="Type">
            <Select value={leaveType} onChange={setLeaveType}>
              {options?.leaveTypes.map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase().replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note">
            <Input value={note} onChange={setNote} placeholder="Optional" />
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-4">
          <Toggle checked={isHalfDay} onChange={setIsHalfDay} label="Half day" />
          <button
            onClick={mark}
            disabled={busy || !userId}
            className="ml-auto rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? "Marking…" : "Mark leave"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Marked by</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3 tabular-nums text-slate-900">
                  {String(r.date).slice(0, 10)}
                </td>
                <td className="px-4 py-3 text-slate-700">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {r.leaveType.toLowerCase().replace(/_/g, " ")}
                  {r.isHalfDay && <span className="ml-1 text-xs text-slate-400">half</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{r.note ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{r.markedBy}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => unmark(r)}
                    className="text-xs text-slate-300 hover:text-rose-600"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No leave marked this month.
          </p>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Small shared pieces
// ===========================================================================

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="font-medium text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 transition hover:text-slate-900"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4 p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <input
      type={type}
      step={step}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
    >
      {children}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span>
        <span className="block text-sm text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}
