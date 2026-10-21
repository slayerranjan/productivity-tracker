import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Every route past /auth/login runs through requireAuth. It reads the bearer
// token, verifies it, and hangs the result on req.user — which is what every
// service means by "viewerId". The global declaration is what makes req.user
// exist in TypeScript across the whole project.

export type AuthUser = {
  userId: string;
  platformId: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "NOT_AUTHENTICATED" });
    return;
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as Partial<AuthUser>;

    if (!payload?.userId || !payload?.platformId) {
      res.status(401).json({ error: "INVALID_TOKEN" });
      return;
    }

    req.user = {
      userId: String(payload.userId),
      platformId: String(payload.platformId),
      role: String(payload.role ?? "EMPLOYEE"),
    };

    next();
  } catch {
    // Expired and tampered tokens look identical to the caller on purpose.
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "NOT_AUTHENTICATED" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "NOT_ALLOWED" });
      return;
    }
    next();
  };
}
