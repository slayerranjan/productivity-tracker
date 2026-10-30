"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Bell from "./_notifications/Bell";
import Link from "next/link";
import { apiGet, clearToken, getToken } from "@/lib/api";
import { setPlatformTimezone } from "@/lib/time";

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
  platform: { id: string; name: string; slug: string; timezone?: string };
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
  grid: (p: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1.4" />
      <rect x="11" y="3" width="6" height="6" rx="1.4" />
      <rect x="3" y="11" width="6" height="6" rx="1.4" />
      <rect x="11" y="11" width="6" height="6" rx="1.4" />
    </svg>
  ),
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
  // Hidden for these roles. HR and Admin get the HR dashboard at /dashboard,
  // so the "Today" entry that other roles see is replaced for them.
  notRoles?: string[];
  // A live count shown beside the label (HR: requests waiting for a decision).
  badge?: "corrections";
  icon: (p: IconProps) => React.ReactElement;
};

// Grouped, because eleven flat links is a list to read rather than a menu to
// scan. "Me" is my own day, "My team" is other people, "Setup" is config
// that HR touches once a month.
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Main",
    items: [
      { href: "/dashboard", label: "Dashboard", ready: true, roles: ["HR", "ADMIN"], icon: I.grid },
      { href: "/dashboard", label: "Today", ready: true, notRoles: ["HR", "ADMIN"], icon: I.today },
      { href: "/dashboard/admin", label: "Employees", ready: true, roles: ["HR", "ADMIN"], icon: I.team },
      { href: "/dashboard/team", label: "Attendance", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.holidays },
      { href: "/dashboard/team-attendance", label: "Team Attendance", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.team },
      { href: "/dashboard/corrections", label: "Corrections", ready: true, roles: ["HR", "ADMIN"], badge: "corrections", icon: I.history },
      { href: "/dashboard/today", label: "Productivity Tracker", ready: true, roles: ["HR", "ADMIN"], icon: I.today },
      { href: "/dashboard/approvals", label: "Tasks & Performance", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.approvals },
      { href: "/dashboard/reports", label: "Reports & Analytics", ready: true, roles: ["MANAGER", "HR", "ADMIN"], icon: I.reports },
    ],
  },
  {
    title: "Me",
    items: [
      { href: "/dashboard/tasks", label: "Daily Tasks", ready: true, icon: I.tasks },
      { href: "/dashboard/history", label: "My History", ready: true, icon: I.history },
      { href: "/dashboard/corrections", label: "Corrections", ready: true, notRoles: ["HR", "ADMIN"], icon: I.approvals },
      { href: "/dashboard/leave", label: "Leave", ready: true, icon: I.holidays },
      { href: "/dashboard/documents", label: "Documents", ready: true, icon: I.payslip },
      { href: "/dashboard/meetings", label: "Meetings", ready: true, icon: I.team },
      { href: "/dashboard/policies", label: "Policies", ready: true, icon: I.approvals },
      { href: "/dashboard/tickets", label: "Tickets", ready: true, icon: I.ticket },
      { href: "/dashboard/payslips", label: "My Payslips", ready: true, icon: I.payslip },
      { href: "/dashboard/profile", label: "My Profile", ready: true, icon: I.payslip },
      { href: "/change-password", label: "Change password", ready: true, icon: I.admin },
    ],
  },
  {
    // Hiring is its own section, not part of Settings and not part of
    // Approvals. Approvals means a manager clearing someone's daily tasks;
    // this is HR clearing documents. Same word, different job.
    title: "Hiring",
    items: [
      { href: "/dashboard/candidates", label: "Joiners", ready: true, roles: ["HR", "ADMIN"], icon: I.team },
      { href: "/dashboard/offers", label: "Offer letters", ready: true, roles: ["HR", "ADMIN"], icon: I.payslip },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/dashboard/projects", label: "Projects", ready: true, roles: ["HR", "ADMIN"], icon: I.tasks },
      { href: "/dashboard/companies", label: "Companies", ready: true, roles: ["HR", "ADMIN"], icon: I.team },
      { href: "/dashboard/audit-logs", label: "Audit log", ready: true, roles: ["HR", "ADMIN"], icon: I.reports },
      { href: "/dashboard/holidays", label: "Holidays", ready: true, roles: ["HR", "ADMIN"], icon: I.holidays },
      { href: "/dashboard/payroll", label: "Payroll", ready: true, roles: ["HR", "ADMIN"], icon: I.payroll },
      { href: "/dashboard/admin?tab=Teams", label: "Teams, shifts & rules", ready: true, roles: ["ADMIN", "HR"], icon: I.admin },
    ],
  },
];

const ROLE_CHIP: Record<string, string> = {
  ADMIN: "bg-violet-100 text-violet-700",
  HR: "bg-sky-100 text-sky-700",
  MANAGER: "bg-emerald-100 text-emerald-700",
  EMPLOYEE: "bg-slate-100 text-slate-600",
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
  const [pendingCorrections, setPendingCorrections] = useState(0);

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
        // Until HR has approved their papers there is no tracker to show. A
        // locked clock reading 00:00:00 tells a new joiner nothing; the list
        // of documents they owe tells them exactly what to do next.
        if (!m.trackerAccessEnabled) {
          router.replace("/onboarding");
          return;
        }
        setPlatformTimezone(m.platform.timezone);
        setMe(m);
      })
      .catch((err) => setError(err.message));

  }, [router]);

  // The tab shows the page you are on, under the product name.
  useEffect(() => {
    const role = me?.role ?? "";
    const item = GROUPS.flatMap((g) => g.items).find(
      (i) => i.href.split("?")[0] === pathname && (!i.roles || i.roles.includes(role)) && !(i.notRoles ?? []).includes(role)
    );
    document.title = item ? `${item.label} | Avatar HRMS` : "Avatar HRMS";
  }, [pathname, me?.role]);

  // HR/Admin: how many correction requests are waiting. Refreshed every minute and when the tab is focused.
  const isReviewer = me?.role === "HR" || me?.role === "ADMIN";
  useEffect(() => {
    if (!isReviewer) return;
    const load = () => {
      apiGet<{ pending: number }>("/attendance-corrections/pending-count")
        .then((r) => setPendingCorrections(r.pending))
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [isReviewer, pathname]);

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
        <div className="m-4 mr-0 hidden w-64 shrink-0 rounded-3xl bg-white shadow-[var(--shadow-lift)] lg:block" />
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
    items: g.items.filter(
      (i) =>
        (!i.roles || i.roles.includes(me.role)) &&
        !(i.notRoles && i.notRoles.includes(me.role))
    ),
  })).filter((g) => g.items.length > 0);

  const sidebar = (
    <aside className="flex h-full w-64 shrink-0 flex-col rounded-3xl bg-[var(--nav-bg)] shadow-[var(--shadow-lift)]">
      {/* Brand. The product is HRMS; the company you are signed into sits
          underneath, because with ten companies in the group, knowing which
          one matters. */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-md shadow-indigo-600/30">
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 5v14M17 5v14M7 12h10" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[17px] font-bold leading-tight tracking-tight text-slate-900">Avatar HRMS</p>
          <p className="truncate text-[11px] text-slate-500">{me.platform.name}</p>
        </div>
        <div className="ml-auto shrink-0"><Bell /></div>
      </div>

      <nav className="flex-1 overflow-y-auto pb-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="px-6 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                // Items that deep-link with ?tab= are never "active"; the
                // plain page entry owns the highlight.
                const active = !item.href.includes("?") && pathname === item.href;
                const Icon = item.icon;

                if (!item.ready) {
                  return (
                    <div
                      key={item.label}
                      className="mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-slate-400"
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
                        soon
                      </span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`group relative mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] ${
                      active
                        ? "bg-[var(--nav-active-bg)] font-semibold text-[var(--nav-active)]"
                        : "text-[var(--nav-text)] hover:bg-[var(--nav-hover)] hover:text-slate-900"
                    }`}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${
                        active ? "text-[var(--nav-active)]" : "text-slate-400 group-hover:text-indigo-500"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badge === "corrections" && pendingCorrections > 0 && (
                      <span data-testid="corrections-badge" className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{Math.min(99, pendingCorrections)}</span>
                    )}
                    {/* The reference marks the current page with a bar on the
                        card's outer edge, readable from across a desk. */}
                    {active && (
                      <span className="absolute -right-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-l bg-[var(--nav-active)]" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[12px] font-semibold text-indigo-700">
            {initials(fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">
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
                <span className="truncate text-[10px] text-slate-400">
                  {me.employeeCode}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-[var(--nav-text)] hover:bg-[var(--nav-hover)] hover:text-slate-900"
        >
          <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M8 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" strokeLinecap="round" />
            <path d="M12.5 7 15.5 10l-3 3M15.5 10H8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Logout
        </button>
      </div>
    </aside>
  );

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen bg-[var(--background)]">
        {/* Desktop */}
        <div className="sticky top-0 hidden h-screen p-4 pr-0 lg:block">{sidebar}</div>

        {/* Mobile drawer — people will open this on a phone to clock in */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-slate-900/50"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full animate-in p-3">{sidebar}</div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-indigo-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-[12px] font-bold text-white">
              H
            </div>
            <p className="truncate text-sm font-semibold text-slate-900">
              Avatar HRMS <span className="font-normal text-slate-400">· {me.platform.name}</span>
            </p>
          </header>

          <div className="animate-in">{children}</div>
        </div>
      </div>
    </MeContext.Provider>
  );
}