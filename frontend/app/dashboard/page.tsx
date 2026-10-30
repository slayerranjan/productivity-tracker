// ===========================================================================
// DASHBOARD HOME
//
// One URL, two screens, chosen by role. HR and Admin land on the HR overview;
// everyone else keeps their own Today screen (clock, breaks, timer).
// The role comes from useMe(), which the layout fills from /auth/me, and the
// backend enforces access to every number the HR screen shows regardless.
// ===========================================================================

"use client";

import { useMe } from "./layout";
import TodayView from "./TodayView";
import HrDashboard from "./HrDashboard";

export default function DashboardPage() {
  const me = useMe();
  if (me && (me.role === "HR" || me.role === "ADMIN")) return <HrDashboard />;
  return <TodayView />;
}
