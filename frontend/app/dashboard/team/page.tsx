import { redirect } from "next/navigation";

// "Your team today" and "Team Attendance" were the same screen twice. They are now one page, Attendance, at
// /dashboard/team-attendance (live board, alerts and meeting invites). This keeps old links and bookmarks working.
export default function TeamRedirect() {
  redirect("/dashboard/team-attendance");
}
