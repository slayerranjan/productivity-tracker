import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// AUDIT
//
// Sits in front of every route, so a screen written months from now is
// covered without anyone remembering to add logging to it. Only records
// changes — GETs are noise — and only successful ones.
//
// Writing happens AFTER the response is sent, so auditing can never slow a
// request or fail one. A logging failure must never break the thing being
// logged.
// ---------------------------------------------------------------------------

// Anything whose name looks like a secret is replaced, at any depth.
const SECRET = /password|token|secret|hash|otp|pin/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || typeof value !== "object") {
    // Base64 file uploads are megabytes of noise.
    if (typeof value === "string" && value.length > 300) {
      return `[${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redact(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function audit(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "OPTIONS") return next();

  res.on("finish", () => {
    // Only successful changes. A rejected request isn't a change.
    if (res.statusCode >= 400) return;

    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0];

    void prisma.auditLog
      .create({
        data: {
          actorId: req.user?.userId ?? null,
          platformId: req.user?.platformId ?? null,
          method: req.method,
          path: req.originalUrl.split("?")[0],
          status: res.statusCode,
          detail: redact(req.body ?? {}) as never,
          ip: forwarded.trim() || req.ip || null,
        },
      })
      .catch((err: unknown) => {
        console.error("[audit] could not record:", err);
      });
  });

  next();
}