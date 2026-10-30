// Small helpers shared by the team attendance views (Reports tabs and the Team Attendance page).

const pad = (n: number) => String(n).padStart(2, "0");

// 1:05:09 — a running clock. null means "nothing recorded", shown as a dash, never as zero.
export function clock(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// 2h 05m / 45m
export function hm(sec: number | null): string {
  if (sec === null) return "—";
  const m = Math.round(Math.max(0, sec) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}

export const hmFromHours = (h: number | null) => (h === null ? "—" : hm(h * 3600));
export const hmFromMinutes = (min: number | null) => (min === null ? "—" : min <= 0 ? "—" : hm(min * 60));

// A time of day in the company timezone, e.g. "10:04 AM".
export function clockTime(iso: string | null, tz: string): string {
  return iso ? new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso)) : "—";
}

// "30 Oct 2026" from "2026-10-30" (read as a calendar day, not shifted by the browser timezone).
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

// --- CSV ---------------------------------------------------------------------------------------
// Built in the browser from the rows on screen, so the file always equals what the manager sees.
// A cell that starts with = + - @ would run as a formula when opened in Excel, so it is prefixed with '.
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
