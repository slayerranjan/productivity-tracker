// Where the backend lives.
//
// NEXT_PUBLIC_API_URL still wins if it is set, so a different deployment can
// point somewhere else. But the fallback is no longer localhost for everyone:
// a browser that is not on localhost gets the live server. A missing or
// mistyped setting used to produce "Route not found" with nothing to explain
// it, which is a bad way to find out a variable did not reach the build.
const LIVE_API = "https://productivity-tracker-ps8u.onrender.com/api";
const LOCAL_API = "http://localhost:5001/api";

// Whatever the setting says, the backend only answers under /api. Rather than
// trusting every future deployment to remember that suffix - and failing with
// an unexplained "Route not found" when one does not - the suffix is enforced
// here, along with stripping any trailing slash.
function withApiSuffix(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

const configured =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? LIVE_API
    : LOCAL_API);

const API_URL = withApiSuffix(configured);

// Shared so no page builds this address for itself. Pages that did were
// bypassing the /api handling entirely and calling a path the server does
// not serve.
export const API_BASE = API_URL;

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setToken(token: string) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

function headers() {
  const token = getToken();
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body ?? {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: headers() });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as T;
}