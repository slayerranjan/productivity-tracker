// ===========================================================================
// LOGIN
//
// This is the only page that works without a token. Everything else in the
// app redirects here when getToken() comes back empty.
//
// The server deliberately returns the same error for "no such email" and
// "wrong password". Telling them apart would let someone discover which
// email addresses exist — that's called email enumeration.
// ===========================================================================

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, getToken, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in? Don't make them log in again.
  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await apiPost<{ token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(result.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8">
          <div className="h-11 w-11 rounded-xl bg-indigo-600 flex items-center justify-center mb-5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-5 w-5"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Avatar HRMS
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to start your day
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] space-y-4"
        >
                   <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5"
            >
              Employee ID or email
            </label>
            <input
              id="email"
              // NOT type="email" — the browser would reject "AWL-01" before
              // the form ever submits, and nobody in the group has a work
              // email address. The server decides: anything containing "@"
              // is treated as an email, anything else as an employee ID.
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="AWL-01"
              className="w-full rounded-xl border border-indigo-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              Use the employee ID your company issued you.
            </p>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-indigo-200 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Trouble signing in? Raise it with HR.
        </p>
      </div>
    </main>
  );
}