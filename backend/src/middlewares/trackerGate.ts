// ===========================================================================
// TRACKER GATE
//
// Hiding the clock-in button is not security. This middleware is what
// actually stops someone who hasn't finished onboarding from recording time —
// a curl request to /api/tracker/clock-in gets the same refusal as the UI.
//
// One indexed lookup per tracker request. If that ever shows up in a profile,
// the fix is to put trackerAccessEnabled in the JWT and re-issue the token
// when the gate opens — not to remove the check.
// ===========================================================================

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

export async function requireTrackerAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Not signed in." });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        trackerAccessEnabled: true,
        mustChangePassword: true,
        onboardingStatus: true,
      },
    });

    if (!user) return res.status(401).json({ error: "Not signed in." });

    // Must be dealt with before anything else, so a temporary password
    // chosen by HR can't be used to record a day's work.
    if (user.mustChangePassword) {
      return res.status(403).json({
        error: "Set your own password before using the tracker.",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    if (!user.trackerAccessEnabled) {
      return res.status(403).json({
        error: "Your onboarding isn't complete yet, so the tracker is locked.",
        code: "ONBOARDING_INCOMPLETE",
        onboardingStatus: user.onboardingStatus,
      });
    }

    return next();
  } catch (error) {
    console.error("[trackerGate]", error);
    return res.status(500).json({ error: "Something went wrong." });
  }
}