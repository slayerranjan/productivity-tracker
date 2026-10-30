import type { Router } from "express";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Call once per router, right after `Router()`. Every id in this system is a UUID.
export function guardUuidParams(router: Router, names: string[] = ["id", "userId", "teamId"]) {
  for (const name of names) {
    router.param(name, (_req, res, next, value) => {
      if (!UUID.test(String(value))) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    });
  }
}

export const isUuid = (v: unknown) => UUID.test(String(v ?? ""));

// A database or runtime error caused by a value the client sent (a malformed id, an impossible date)
// is the client's mistake: answer 400, not 500.
export function isBadInput(error: unknown): boolean {
  const e = error as { code?: string; name?: string; message?: string } | null;
  const msg = String(e?.message ?? "");
  return (
    e?.code === "P2023" ||
    e?.name === "PrismaClientValidationError" ||
    (e instanceof RangeError && /Invalid time value|Invalid Date/i.test(msg)) ||
    /invalid input syntax for type|out of range for type/i.test(msg)
  );
}
