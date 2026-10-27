import { Router, type Response } from "express";
import * as tracker from "./tracker.service.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";

const router = Router();

// Everything below requires a valid token.
router.use(requireAuth);

// One place that turns internal error codes into messages a person can read.
// The service throws codes; only this layer decides wording and status.
const MESSAGES: Record<string, { status: number; message: string }> = {
  USER_NOT_FOUND: { status: 404, message: "User not found" },
  TRACKER_LOCKED: {
    status: 403,
    message: "Your tracker access has not been enabled yet",
  },
  NO_ACTIVE_SESSION: { status: 400, message: "You are not clocked in" },
  ALREADY_COMPLETED: {
    status: 400,
    message: "You have already completed your workday",
  },
  BREAK_ALREADY_RUNNING: { status: 400, message: "A break is already running" },
  NO_BREAK_RUNNING: { status: 400, message: "No break is running" },
  MEETING_RUNNING: {
    status: 400,
    message: "End your meeting before taking a break",
  },
  NO_MEETING_RUNNING: { status: 400, message: "No meeting is running" },
  MEETING_NOT_FOUND: { status: 404, message: "Meeting not found" },
    ALERT_NOT_FOUND: { status: 404, message: "Alert not found" },
  NOT_YOURS: { status: 403, message: "That invite is not addressed to you" },
  ALREADY_ANSWERED: {
    status: 400,
    message: "This invite has already been answered",
  },
  NOT_ALLOWED: { status: 403, message: "Only a manager can start a meeting" },
};

function fail(res: Response, error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known = MESSAGES[code];

  if (known) return res.status(known.status).json({ error: known.message });

  console.error("Tracker error:", error);
  return res.status(500).json({ error: "Something went wrong" });
}

// --- My day ---------------------------------------------------------------

router.get("/session", async (req, res) => {
  try {
    res.json(await tracker.getActiveSession(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/clock-in", async (req, res) => {
  try {
    res.json(await tracker.clockIn(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/clock-out", async (req, res) => {
  try {
    res.json(await tracker.clockOut(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

// --- Breaks ---------------------------------------------------------------

router.post("/break/start", async (req, res) => {
  const { breakType } = req.body ?? {};

  const allowed = ["TEA", "LUNCH", "WASHROOM", "PERSONAL", "OTHER"];
  if (!allowed.includes(breakType)) {
    return res.status(400).json({ error: "Pick a valid break type" });
  }

  try {
    res.json(await tracker.startBreak(req.user!.userId, breakType));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/break/end", async (req, res) => {
  try {
    res.json(await tracker.endBreak(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

// --- Meeting invites ------------------------------------------------------

// Manager sends. requireRole blocks employees at the door — the service
// checks again, because a route is not the only way in.
router.post(
  "/meetings/invite",
  requireRole("MANAGER", "HR", "ADMIN"),
  async (req, res) => {
    const { employeeIds, meetingType, title } = req.body ?? {};

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: "Pick at least one person" });
    }

    const allowed = [
      "TEAM",
      "CLIENT",
      "ONE_ON_ONE",
      "TRAINING",
      "INTERVIEW",
      "OTHER",
    ];
    if (!allowed.includes(meetingType)) {
      return res.status(400).json({ error: "Pick a valid meeting type" });
    }

    try {
      res.json(
        await tracker.inviteToMeeting(
          req.user!.userId,
          employeeIds,
          meetingType,
          title
        )
      );
    } catch (error) {
      fail(res, error);
    }
  }
);

// What the employee's badge polls.
router.get("/invites", async (req, res) => {
  try {
    res.json(await tracker.listPendingInvites(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/invites/:id/respond", async (req, res) => {
  const { accept, reason } = req.body ?? {};

  if (typeof accept !== "boolean") {
    return res.status(400).json({ error: "Accept or decline is required" });
  }

  try {
    res.json(
      await tracker.respondToMeeting(
        req.user!.userId,
        String(req.params.id),
        accept,
        reason
      )
    );
  } catch (error) {
    fail(res, error);
  }
});

// Only the manager who called the meeting can end it. An employee ending it
// could stop it hours later, or stop it for everyone else mid-meeting.
router.post("/meeting/end", requireRole("MANAGER", "HR", "ADMIN"), async (req, res) => {
  try {
    res.json(await tracker.endMeetingForAll(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

// --- Manager view ---------------------------------------------------------

router.get(
  "/team",
  requireRole("MANAGER", "HR", "ADMIN"),
  async (req, res) => {
    try {
      res.json(await tracker.getTeamLiveStatus(req.user!.userId));
    } catch (error) {
      fail(res, error);
    }
  }
);


router.get("/history", async (req, res) => {
  const { from, to } = req.query;
  try {
    res.json(
      await tracker.getHistory(
        req.user!.userId,
        typeof from === "string" ? from : undefined,
        typeof to === "string" ? to : undefined
      )
    );
  } catch (error) {
    fail(res, error);
  }
});

// --- Alerts ---------------------------------------------------------------

router.get("/alerts", requireRole("MANAGER", "HR", "ADMIN"), async (req, res) => {
  try {
    res.json(await tracker.listTeamAlerts(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  "/alerts/:id/ack",
  requireRole("MANAGER", "HR", "ADMIN"),
  async (req, res) => {
    try {
      res.json(
        await tracker.acknowledgeAlert(req.user!.userId, String(req.params.id))
      );
    } catch (error) {
      fail(res, error);
    }
  }
);

export default router;