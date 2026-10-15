import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  userId: string;
  platformId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not signed in" });
  }

  try {
    const payload = jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET as string
    ) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res
      .status(401)
      .json({ error: "Session expired. Please sign in again." });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not signed in" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have access to this" });
    }
    next();
  };
}