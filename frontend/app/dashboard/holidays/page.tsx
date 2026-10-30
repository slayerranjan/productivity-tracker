"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useMe } from "../layout";

type Company = { id: string; name: string };

type Holiday = {
  id: string;
  platformId: string;
  company: string | null;
  date: string;
  name: string;
  dayType: string;
  isPast: boolean;
  weekday: string;
};

type Data = {
  year: number;
  today: string;
  years: number[];
  companies: Company[];
  holidays: Holiday[];
  countsByCompany: { id: string; name: string; count: number }[];
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MESSAGES: Record<string, string> = {
  NAME_REQUIRED: "Give the holiday a name.",
  NAME_TOO_LONG: "That name is too long.",
  BAD_DATE: "That date doesn't look right.",
  DATE_IN_THE_PAST:
    "That date has already passed. Holidays must be set before the day arrives, otherwise reports people have already seen would change.",
  NOT_YOUR_COMPANY: "You can't set holidays for that company.",
  NOT_ALLOWED: "Only HR and Admin can manage holidays.",
  NOT_FOUND: "That holiday no longer exists.",
};

function say(err: unknown) {
  const code = err instanceof Error ? err.message : "UNKNOWN";
  return MESSAGES[code] ?? "Something went wrong.";
}

export default function HolidaysPage() {
  const me = useMe();

  const [data, setData] = useState<Data | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // --- the add form
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [applyToAll, setApplyToAll] = useState(true);

  const load = useCallback(
    async (y?: number) => {
      try {
        const q = y ? `?year=${y}` : "";
        const res = await apiGet<Data>(`/holidays${q}`);
        setData(res);
        setYear(res.year);
        if (!companyId && res.companies.length > 0) {
          setCompanyId(res.companies[0].id);
        }
        setError("");
      } catch (err) {
        setError(say(err));
      }
    },
    [companyId]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiPost<Data>("/holidays", {
        date,
        name: name.trim(),
        platformId: applyToAll ? undefined : companyId,
        applyToAll,
      });
      setData(res);
      setYear(res.year);
      setNotice(
        applyToAll
          ? `Added "${name.trim()}" to every company.`
          : `Added "${name.trim()}".`
      );
      setDate("");
      setName("");
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(h: Holiday) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiPost<Data>(`/holidays/${h.id}/delete`);
      setData(res);
      setNotice(`Removed ${h.name}.`);
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  }

  // Group by month so a year reads like a calendar rather than a flat list.
  const byMonth = useMemo(() => {
    const map = new Map<number, Holiday[]>();
    for (const h of data?.holidays ?? []) {
      const m = Number(h.date.slice(5, 7)) - 1;
      if (!map.has(m)) map.set(m, []);
      map.get(m)!.push(h);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [data]);

  if (!me) return null;

  const canSubmit = date !== "" && name.trim() !== "" && !busy;
  const multiCompany = (data?.companies.length ?? 0) > 1;

  return (
    <div className="p-8 page-4xl">
      <header className="mb-6">
        <p className="text-sm text-slate-400">HR setup</p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-0.5">
          Holidays
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          Set these before the month starts. A holiday is removed from
          everyone&apos;s target for that month, so nobody looks like they
          under-delivered on a day the office was shut.
        </p>
      </header>

      {/* ---- year switcher + per-company counts ---- */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-xl border border-indigo-100 bg-white p-1">
          {(data?.years ?? []).map((y) => (
            <button
              key={y}
              onClick={() => load(y)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                y === year
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {(data?.countsByCompany ?? []).map((c) => (
            <span
              key={c.id}
              className="rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs text-slate-600"
            >
              {c.name}
              <span className="ml-1.5 font-semibold text-slate-900 tabular-nums">
                {c.count}
              </span>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {/* ---- add a holiday ---- */}
      <section className="mb-8 rounded-2xl bg-white shadow-[var(--shadow-card)] p-5">
        <h2 className="text-sm font-medium text-slate-900 mb-4">
          Add a holiday
        </h2>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              min={data?.today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-indigo-100 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div className="flex-1 min-w-56">
            <label className="block text-xs text-slate-500 mb-1.5">
              What is it called?
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Diwali, Independence Day, Founders Day..."
              className="w-full rounded-xl border border-indigo-100 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {multiCompany && (
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Company
              </label>
              <select
                value={applyToAll ? "__all" : companyId}
                onChange={(e) => {
                  if (e.target.value === "__all") {
                    setApplyToAll(true);
                  } else {
                    setApplyToAll(false);
                    setCompanyId(e.target.value);
                  }
                }}
                className="rounded-xl border border-indigo-100 px-3 py-2 text-sm text-slate-900"
              >
                <option value="__all">All companies</option>
                {(data?.companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            disabled={!canSubmit}
            onClick={add}
            className="rounded-xl bg-indigo-600 text-white text-sm font-medium px-5 py-2 hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Add holiday"}
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-3">
          {multiCompany
            ? "All companies is the usual choice for national holidays. Pick one company for a holiday only it observes."
            : "This applies to your company."}
        </p>
      </section>

      {/* ---- the year ---- */}
      {byMonth.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-[var(--shadow-card)] px-6 py-12 text-center">
          <p className="text-sm text-slate-500">
            No holidays set for {year}.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Until you add them, every working day counts towards attainment.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {byMonth.map(([month, list]) => (
            <section
              key={month}
              className="rounded-2xl bg-white shadow-[var(--shadow-card)] overflow-hidden"
            >
              <div className="px-5 py-2.5 border-b border-indigo-50 bg-slate-50/60 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  {MONTHS[month]} {year}
                </h3>
                <span className="text-xs text-slate-400">
                  {list.length} {list.length === 1 ? "day" : "days"}
                </span>
              </div>

              <ul className="divide-y divide-indigo-50">
                {list.map((h) => (
                  <li
                    key={h.id}
                    className="px-5 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-14 shrink-0 text-center">
                        <p className="text-lg font-semibold text-slate-900 tabular-nums leading-none">
                          {h.date.slice(8, 10)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {h.weekday.slice(0, 3)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {h.name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {h.company ?? "Unknown company"}
                          {h.isPast ? " - already passed" : ""}
                        </p>
                      </div>
                    </div>

                    {h.isPast ? (
                      <span className="shrink-0 text-xs text-slate-300">
                        locked
                      </span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => remove(h)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-600 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}