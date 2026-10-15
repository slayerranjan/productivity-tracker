"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, clearToken, getToken } from "@/lib/api";

type Me = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  employeeCode: string | null;
  platform: { name: string };
};

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    apiGet<Me>("/auth/me")
      .then(setMe)
      .catch((err) => setError(err.message));
  }, [router]);

  function signOut() {
    clearToken();
    router.push("/login");
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {me.firstName} {me.lastName}
            </h1>
            <p className="text-sm text-slate-500">{me.platform.name}</p>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-slate-600 hover:text-slate-900 underline"
          >
            Sign out
          </button>
        </div>

        <dl className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {[
            ["Email", me.email],
            ["Role", me.role],
            ["Employee code", me.employeeCode ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between px-5 py-3.5">
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="text-sm font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}