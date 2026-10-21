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
    mustChangePassword?: boolean;
  platform: { id: string; name: string; slug: string };
};

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

// ---------------------------------------------------------------------------
// ICONS
// Inline SVG rather than an icon package: no dependency to install, no
// version to break, and they inherit colour from the link they sit in.
// ---------------------------------------------------------------------------
type IconProps = { className?: string };
const I = {
  today: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.5V10l2.5 1.8" strokeLinecap="round" />
    </svg>
  ),
  tasks: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M3 5.5 4.6 7 7.5 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12.5 4.6 14l2.9-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 5.5H17M10.5 12.5H17" strokeLinecap="round" />
    </svg>
  ),
  history: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M3.2 8a7 7 0 1 1 1.3 5.4" strokeLinecap="round" />
      <path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 7v3.2l2.3 1.5" strokeLinecap="round" />
    </svg>
  ),
  ticket: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M3 7.5a1.5 1.5 0 0 0 0 5V15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a1.5 1.5 0 0 1 0-5V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
      <path d="M10 7v6" strokeDasharray="1.5 2" strokeLinecap="round" />
    </svg>
  ),
  payslip: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M5 2.5h10a1 1 0 0 1 1 1v13l-2.3-1.4-1.9 1.4-1.8-1.4-1.9 1.4L6 15.1 4 16.5v-13a1 1 0 0 1 1-1z" />
      <path d="M7.5 7h5M7.5 10h3" strokeLinecap="round" />
    </svg>
  ),
  approvals: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M4 10.5 8 14.5 16 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  team: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.6 16c0-2.6 2.2-4.3 4.9-4.3s4.9 1.7 4.9 4.3" strokeLinecap="round" />
      <path d="M13.4 5.1a2.4 2.4 0 0 1 0 4.4M14.6 11.9c1.6.5 2.8 1.9 2.8 4.1" strokeLinecap="round" />
    </svg>
  ),
  reports: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <path d="M3 17h14" strokeLinecap="round" />
      <path d="M5.5 17V9M10 17V4.5M14.5 17v-5.5" strokeLinecap="round" />
    </svg>
  ),
  holidays: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <rect x="3" y="4.5" width="14" height="12" rx="1.6" />
      <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
      <circle cx="10" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  payroll: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <rect x="2.5" y="5.5" width="15" height="10" rx="1.6" />
      <circle cx="10" cy="10.5" r="2.2" />
      <path d="M5 10.5h.01M15 10.5h.01" strokeLinecap="round" />
    </svg>
  ),
  admin: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="10" cy="10" r="2.4" />
      <path d="M10 2.6v2M10 15.4v2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M2.6 10h2M15.4 10h2M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" strokeLinecap="round" />
    </svg>
  ),
};

type NavItem = {
  href: string;
  label: string;
  ready: boolean;
  roles?: string[];
  icon: (p: IconProps) => React.ReactElement;
};

// Grouped, because eleven flat links is a list to read rather than a menu to
// scan. "Me" is my own day, "My team" is other people, "Setup" is config
// that HR touches once a month.
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Me",
    items: [
      { href: "/dashboard", label: "Today", ready: true, icon: I.today },
      { href: "/dashboard/tasks", label: "Daily Tasks", ready: true, icon: I.tasks },
      { href: "/dashboard/history", label: "My History", ready: true, icon: I.history },
      { href: "/dashboard/tickets", label: "Tickets", ready: true, icon: I.ticket },
      { href: "/dashboard/payslips", label: "My Payslips", ready: true, icon: I.payslip },
      { href: "/dashboard/profile", label: "My Profile", ready: true, icon: I.payslip },
            { href: "/change-password", label: "Change password", ready: true, icon: I.admin },
    ],
  },
  {
    title: "My team",
    items: [
      { href: "/dashboard/approvals", label: "Approvals", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.approvals },
      { href: "/dashboard/team", label: "Live Team", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.team },
      { href: "/dashboard/reports", label: "Reports", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.reports },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/dashboard/projects", label: "Projects", ready: true, roles: ["HR", "ADMIN"], icon: I.tasks },
     { href: "/dashboard/holidays", label: "Holidays", ready: true, roles: ["HR", "ADMIN"], icon: I.holidays },
      { href: "/dashboard/payroll", label: "Payroll", ready: true, roles: ["HR", "ADMIN"], icon: I.payroll },
      { href: "/dashboard/admin", label: "Admin", ready: true, roles: ["ADMIN", "HR"], icon: I.admin },
      { href: "/dashboard/offers", label: "Offer letters", ready: true, roles: ["HR", "ADMIN"], icon: I.payslip },
    ],
  },
];

const ROLE_CHIP: Record<string, string> = {
  ADMIN: "bg-violet-500/15 text-violet-300",
  HR: "bg-sky-500/15 text-sky-300",
  MANAGER: "bg-emerald-500/15 text-emerald-300",
  EMPLOYEE: "bg-slate-500/20 text-slate-300",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
        apiGet<Me>("/auth/me")
      .then((m) => {
        // Nobody gets into the app on a password HR chose for them.
        if (m.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        setMe(m);
      })
      .catch((err) => setError(err.message));

  }, [router]);

  // Close the mobile drawer on navigation, otherwise it covers the page you
  // just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function signOut() {
    clearToken();
    router.replace("/login");
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-[var(--shadow-lift)]">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-50">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 6.5v5M10 14h.01" strokeLinecap="round" />
              <circle cx="10" cy="10" r="7.5" />
            </svg>
          </div>
          <p className="text-sm text-slate-700">{error}</p>
          <button
            onClick={signOut}
            className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign in again
          </button>
        </div>
      </main>
    );
  }

  // A skeleton rather than the word "Loading" — the shell appears instantly
  // so the app feels like it started, not like it stalled.
  if (!me) {
    return (
      <div className="min-h-screen flex bg-[var(--background)]">
        <div className="hidden w-64 shrink-0 bg-[var(--sidebar)] lg:block" />
        <div className="flex-1 p-8">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton mt-3 h-8 w-64" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="skeleton h-24" />
            <div className="skeleton h-24" />
            <div className="skeleton h-24" />
          </div>
          <div className="skeleton mt-6 h-64" />
        </div>
      </div>
    );
  }

  const fullName = `${me.firstName} ${me.lastName}`.trim();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(me.role)),
  })).filter((g) => g.items.length > 0);

  const sidebar = (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-[var(--sidebar)]">
      {/* Company identity. With ten companies in the group, knowing which one
          you're signed into matters more than the product name. */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[13px] font-bold text-white">
          {initials(me.platform.name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-white">
            {me.platform.name}
          </p>
          <p className="text-[11px] text-slate-500">Productivity Tracker</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;

                if (!item.ready) {
                  return (
                    <div
                      key={item.href}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600"
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                        soon
                      </span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                      active
                        ? "bg-white/10 font-medium text-[var(--sidebar-active)]"
                        : "text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-slate-100"
                    }`}
                  >
                    {/* The active marker is a bar, not a background tint —
                        it survives at a glance from across a desk. */}
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-indigo-400" />
                    )}
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        active ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 p-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-200">
            {initials(fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-100">
              {fullName}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-[1px] text-[10px] font-medium ${
                  ROLE_CHIP[me.role] ?? ROLE_CHIP.EMPLOYEE
                }`}
              >
                {me.role.charAt(0) + me.role.slice(1).toLowerCase()}
              </span>
              {me.employeeCode && (
                <span className="truncate text-[10px] text-slate-500">
                  {me.employeeCode}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-[var(--sidebar-hover)] hover:text-slate-200"
        >
          <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" strokeLinecap="round" />
            <path d="M12.5 7 15.5 10l-3 3M15.5 10H8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen bg-[var(--background)]">
        {/* Desktop */}
        <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>

        {/* Mobile drawer — people will open this on a phone to clock in */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-slate-900/50"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full animate-in">{sidebar}</div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] font-bold text-white">
              {initials(me.platform.name)}
            </div>
            <p className="truncate text-sm font-semibold text-slate-900">
              {me.platform.name}
            </p>
          </header>

          <div className="animate-in">{children}</div>
        </div>
      </div>
    </MeContext.Provider>
  );
}