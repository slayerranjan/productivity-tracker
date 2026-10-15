"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, clearToken, getToken } from "@/lib/api";

export type Me = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  employeeCode: string | null;
  designation: string | null;
  trackerAccessEnabled: boolean;
  platform: { id: string; name: string; slug: string };
};

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const NAV = [
  { href: "/dashboard", label: "Today", ready: true },
  { href: "/dashboard/tasks", label: "Daily Tasks", ready: true },
  { href: "/dashboard/history", label: "My History", ready: true },
  { href: "/dashboard/team", label: "Live Team", ready: true, roles: ["MANAGER", "HR", "ADMIN"] },
  { href: "/dashboard/reports", label: "Reports", ready: false, roles: ["MANAGER", "HR", "ADMIN"] },
  { href: "/dashboard/admin", label: "Admin", ready: false, roles: ["ADMIN"] },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiGet<Me>("/auth/me")
      .then(setMe)
      .catch((err) => setError(err.message));
  }, [router]);

  function signOut() {
    clearToken();
    router.replace("/login");
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={signOut} className="text-sm underline text-slate-600">
            Sign in again
          </button>
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading…</p>
      </main>
    );
  }

  const visible = NAV.filter((i) => !i.roles || i.roles.includes(me.role));

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen bg-slate-50 flex">
        <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-5 py-5 border-b border-slate-100">
            <p className="font-semibold text-slate-900 leading-tight">
              {me.platform.name}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Productivity Tracker</p>
          </div>

          <nav className="flex-1 p-3 space-y-0.5">
            {visible.map((item) => {
              const active = pathname === item.href;

              if (!item.ready) {
                return (
                  <div
                    key={item.href}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-slate-300 cursor-default"
                  >
                    <span>{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">
                      soon
                    </span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "block px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700"
                      : "block px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="p-3 border-t border-slate-100">
            <div className="px-3 py-2">
              <p className="text-sm font-medium text-slate-900 truncate">
                {me.firstName} {me.lastName}
              </p>
              <p className="text-xs text-slate-400">
                {me.role.charAt(0) + me.role.slice(1).toLowerCase()}
              </p>
            </div>
            <button
              onClick={signOut}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </MeContext.Provider>
  );
}