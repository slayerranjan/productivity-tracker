"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

type Task = {
  id: string;
  title: string;
  description: string | null;
  weight: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  date: string;
  isCarriedOver: boolean;
};

type Score = {
  totalWeight: number;
  doneWeight: number;
  percent: number;
  total: number;
  completed: number;
};

const WEIGHTS = [
  { value: "LOW", label: "Low", points: 1, chip: "bg-slate-100 text-slate-600" },
  { value: "MEDIUM", label: "Medium", points: 2, chip: "bg-sky-50 text-sky-700" },
  { value: "HIGH", label: "High", points: 3, chip: "bg-amber-50 text-amber-700" },
  {
    value: "CRITICAL",
    label: "Critical",
    points: 5,
    chip: "bg-red-50 text-red-700",
  },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [title, setTitle] = useState("");
  const [weight, setWeight] = useState("MEDIUM");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (data: { tasks: Task[]; score: Score }) => {
    setTasks(data.tasks);
    setScore(data.score);
  };

  const load = useCallback(async () => {
    try {
      apply(await apiGet<{ tasks: Task[]; score: Score }>("/tasks"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tasks");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      if (method === "POST") {
        apply(await apiPost(path, body));
      } else {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001/api"}${path}`,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: body ? JSON.stringify(body) : undefined,
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "That didn't work");
        apply(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await send("/tasks", "POST", { title, weight });
    setTitle("");
    setWeight("MEDIUM");
  }

  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const done = tasks.filter((t) => t.status === "COMPLETED");

  return (
    <div className="p-8 max-w-4xl">
      <header className="mb-6">
        <p className="text-sm text-slate-400">
          {new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="text-2xl font-semibold text-slate-900 mt-0.5">
          Daily tasks
        </h1>
      </header>

      {score && (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 mb-5">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Today's score
              </p>
              <p className="text-3xl font-semibold text-slate-900 mt-1 tabular-nums">
                {score.percent}%
              </p>
            </div>
            <p className="text-sm text-slate-500">
              {score.completed} of {score.total} done ·{" "}
              <span className="tabular-nums">
                {score.doneWeight}/{score.totalWeight}
              </span>{" "}
              points
            </p>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${score.percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Weighted — a critical task counts 5× a low one, so finishing five
            small things doesn't outscore the thing that mattered.
          </p>
        </section>
      )}

      <form
        onSubmit={add}
        className="rounded-2xl border border-slate-200 bg-white p-4 mb-5 flex flex-wrap gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing today?"
          className="flex-1 min-w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-900"
        />
        <select
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        >
          {WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label} · {w.points}pt
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-5 py-2 hover:bg-slate-800 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <TaskList
          heading={`To do (${open.length})`}
          tasks={open}
          busy={busy}
          onToggle={(t) =>
            send(`/tasks/${t.id}`, "PATCH", { status: "COMPLETED" })
          }
          onDelete={(t) => send(`/tasks/${t.id}`, "DELETE")}
        />
        {done.length > 0 && (
          <TaskList
            heading={`Done (${done.length})`}
            tasks={done}
            busy={busy}
            onToggle={(t) => send(`/tasks/${t.id}`, "PATCH", { status: "PENDING" })}
            onDelete={(t) => send(`/tasks/${t.id}`, "DELETE")}
          />
        )}
      </div>
    </div>
  );
}

function TaskList({
  heading,
  tasks,
  busy,
  onToggle,
  onDelete,
}: {
  heading: string;
  tasks: Task[];
  busy: boolean;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h2 className="text-sm font-medium text-slate-900">{heading}</h2>
      </div>

      {tasks.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">
          Nothing here yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => {
            const w = WEIGHTS.find((x) => x.value === t.weight)!;
            const done = t.status === "COMPLETED";

            return (
              <li
                key={t.id}
                className="px-5 py-3 flex items-center gap-3 group hover:bg-slate-50/60"
              >
                <input
                  type="checkbox"
                  checked={done}
                  disabled={busy}
                  onChange={() => onToggle(t)}
                  className="rounded border-slate-300 h-4 w-4"
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm ${
                      done ? "text-slate-400 line-through" : "text-slate-900"
                    }`}
                  >
                    {t.title}
                  </p>
                  {t.isCarriedOver && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      carried over from{" "}
                      {new Date(t.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${w.chip}`}
                >
                  {w.label}
                </span>
                <button
                  onClick={() => onDelete(t)}
                  disabled={busy}
                  className="text-xs text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}