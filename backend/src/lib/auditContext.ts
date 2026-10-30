import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// AUDIT CONTEXT
//
// One audit row is written per request, by the middleware, after the response is
// sent. A service that knows MORE than the URL does (what the value was before, who the
// change is about) calls auditNote(...) while handling the request, and the
// middleware merges that into the same row. One request, one row, no duplicates.
// ---------------------------------------------------------------------------

export type AuditNote = {
  actorId?: string | null;
  platformId?: string | null;
  module?: string;
  action?: string;
  recordType?: string;
  recordId?: string | null;
  targetUserId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  skip?: boolean;
};

type Store = { note: AuditNote };
const als = new AsyncLocalStorage<Store>();

export const runWithAudit = <T>(store: Store, fn: () => T): T => als.run(store, fn);

// Safe to call anywhere: outside a request (a scheduler, a test) it does nothing.
export function auditNote(partial: AuditNote): void {
  const s = als.getStore();
  if (s) Object.assign(s.note, partial);
}

// Anything whose name looks like a secret never goes into an audit row, at any depth.
const SECRET = /password|token|secret|hash|otp|pin|authorization|cookie/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.length > 300 ? `[${value.length} chars]` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET.test(k) ? "[redacted]" : scrub(v, depth + 1);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Only the fields that actually changed, as { before: {...}, after: {...} }.
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    if (!same(before[k], after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: scrub(b), after: scrub(a), any: Object.keys(a).length > 0 };
}
