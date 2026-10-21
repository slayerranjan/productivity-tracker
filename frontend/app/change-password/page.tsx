"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, clearToken, getToken } from "@/lib/api";

// Outside /dashboard on purpose: somebody who must change their password
// should not see the app behind this screen.
export default function ChangePasswordPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiGet<{ firstName: string }>("/auth/me")
      .then((m) => setName(m.firstName))
      .catch(() => router.replace("/login"));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (next.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    if (next === current) {
      setError("Choose something different from the temporary one.");
      return;
    }

    setBusy(true);
    try {
      // A superset body — the endpoint reads the field names it expects and
      // ignores the rest.
      await apiPost("/onboarding/me/password", {
        currentPassword: current,
        oldPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change it");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="h-5 w-5">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {name ? `Welcome, ${name}` : "Set your password"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Choose your own password before you start. The temporary one stops
            working straight away, so nobody else can use it.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Temporary password
            </label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              New password
            </label>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-900"
            />
            <p className="mt-1.5 text-xs text-slate-400">At least 8 characters.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Repeat it
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-900"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !current || !next || !confirm}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Set password and continue"}
          </button>
        </form>

        <button
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
          className="mt-5 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}