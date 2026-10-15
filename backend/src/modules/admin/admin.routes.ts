// ===========================================================================
// ADMIN ROUTES
//
// Two jobs only: check the caller is allowed in, and turn a thrown error
// code into an HTTP status with wording a human can act on. All the thinking
// lives in the service.
//
// requireRole runs on the whole router rather than route by route. One line
// that cannot be forgotten on a new endpoint beats sixteen that can.
// ===========================================================================

import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as admin from "./admin.service.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN", "HR"));

const MESSAGES: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "Not found, or not part of your platform." },
  TEAM_NOT_FOUND: { status: 404, message: "That team doesn't exist on your platform." },
  MISSING_FIELDS: { status: 400, message: "Please fill in all the required fields." },
  EMAIL_TAKEN: { status: 409, message: "Someone on this platform already uses that email." },
  WEAK_PASSWORD: { status: 400, message: "The password must be at least 8 characters." },
  BAD_DATE: { status: 400, message: "Dates must be in YYYY-MM-DD format." },
  BAD_RANGE: { status: 400, message: "The end date cannot be before the start date." },
  RANGE_TOO_LONG: { status: 400, message: "Mark at most 120 days of leave at a time." },
  NO_WORKING_DAYS: { status: 400, message: "A shift needs at least one working day." },
};

function fail(res: any, error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";

  const mapped = MESSAGES[code];
  if (mapped) return res.status(mapped.status).json({ error: mapped.message });

  // Codes that carry the offending field, e.g. BAD_TIME:startTime
  if (code.startsWith("BAD_TIME:")) {
    return res
      .status(400)
      .json({ error: `${code.split(":")[1]} must be a 24-hour time like 09:30.` });
  }
  if (code.startsWith("BAD_NUMBER:")) {
    return res.status(400).json({ error: `${code.split(":")[1]} isn't a valid number.` });
  }

  console.error("[admin]", error);
  return res.status(500).json({ error: "Something went wrong." });
}

const id = (v: unknown) => String(v);

// --- options ---------------------------------------------------------------

router.get("/options", async (req, res) => {
  try {
    res.json(await admin.getAdminOptions(req.user!.userId));
  } catch (e) {
    fail(res, e);
  }
});

// --- people ----------------------------------------------------------------

router.get("/users", async (req, res) => {
  try {
    const users = await admin.listUsers(req.user!.userId, {
      search: req.query.search ? String(req.query.search) : undefined,
      role: req.query.role ? String(req.query.role) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ users });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/users", async (req, res) => {
  try {
    const user = await admin.createUser(req.user!.userId, req.body ?? {});
    res.status(201).json({ user });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/users/:id", async (req, res) => {
  try {
    await admin.updateUser(req.user!.userId, id(req.params.id), req.body ?? {});
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/users/:id/password", async (req, res) => {
  try {
    const password = String(req.body?.password ?? "");
    res.json(await admin.resetPassword(req.user!.userId, id(req.params.id), password));
  } catch (e) {
    fail(res, e);
  }
});

// --- teams -----------------------------------------------------------------

router.get("/teams", async (req, res) => {
  try {
    res.json({ teams: await admin.listTeams(req.user!.userId) });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/teams", async (req, res) => {
  try {
    const team = await admin.createTeam(req.user!.userId, req.body ?? {});
    res.status(201).json({ team });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/teams/:id", async (req, res) => {
  try {
    await admin.updateTeam(req.user!.userId, id(req.params.id), req.body ?? {});
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/teams/:id/members", async (req, res) => {
  try {
    const userId = String(req.body?.userId ?? "");
    res.json(await admin.addTeamMember(req.user!.userId, id(req.params.id), userId));
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/teams/:id/members/:userId", async (req, res) => {
  try {
    res.json(
      await admin.removeTeamMember(
        req.user!.userId,
        id(req.params.id),
        id(req.params.userId)
      )
    );
  } catch (e) {
    fail(res, e);
  }
});

// --- shifts ----------------------------------------------------------------

router.get("/shifts", async (req, res) => {
  try {
    res.json({ shifts: await admin.listShifts(req.user!.userId) });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/shifts", async (req, res) => {
  try {
    const shift = await admin.createShift(req.user!.userId, req.body ?? {});
    res.status(201).json({ shift });
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/shifts/:id", async (req, res) => {
  try {
    await admin.updateShift(req.user!.userId, id(req.params.id), req.body ?? {});
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// --- thresholds ------------------------------------------------------------

router.patch("/config/:teamId", async (req, res) => {
  try {
    const config = await admin.updateTeamConfig(
      req.user!.userId,
      id(req.params.teamId),
      req.body ?? {}
    );
    res.json({ config });
  } catch (e) {
    fail(res, e);
  }
});

// --- leave -----------------------------------------------------------------

router.get("/leave", async (req, res) => {
  try {
    const now = new Date().toISOString().slice(0, 10);
    const from = String(req.query.from ?? `${now.slice(0, 7)}-01`);
    const to = String(req.query.to ?? now);
    res.json({ leave: await admin.listLeave(req.user!.userId, from, to) });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/leave", async (req, res) => {
  try {
    res.status(201).json(await admin.markLeave(req.user!.userId, req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/leave", async (req, res) => {
  try {
    const userId = String(req.query.userId ?? "");
    const date = String(req.query.date ?? "");
    res.json(await admin.unmarkLeave(req.user!.userId, userId, date));
  } catch (e) {
    fail(res, e);
  }
});

export default router;