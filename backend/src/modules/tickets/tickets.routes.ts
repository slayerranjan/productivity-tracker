// ===========================================================================
// TICKET ROUTES
//
// requireAuth only — every employee can raise a ticket. Who may read, reply
// to, or resolve one is decided per ticket in the service, because it depends
// on the ticket's own raiser and assignee, not on the caller's role alone.
// ===========================================================================

import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as tickets from "./tickets.service.js";

const router = Router();

router.use(requireAuth);

const MESSAGES: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "That ticket doesn't exist." },
  FORBIDDEN: { status: 403, message: "That ticket isn't yours to open." },
  MISSING_FIELDS: { status: 400, message: "A subject and a description are required." },
  BAD_CATEGORY: { status: 400, message: "Pick a valid category." },
  BAD_DATE: { status: 400, message: "Dates must be in YYYY-MM-DD format." },
  MISSING_CORRECTION_DATE: {
    status: 400,
    message: "Which date are you correcting?",
  },
  MISSING_CORRECTION_TIMES: {
    status: 400,
    message: "Give at least a clock-in or a clock-out time.",
  },
  NOT_A_CORRECTION: {
    status: 400,
    message: "Only an attendance correction can be applied to a session.",
  },
  ALREADY_APPLIED: {
    status: 409,
    message: "This correction has already been applied once.",
  },
};

function fail(res: any, error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const mapped = MESSAGES[code];
  if (mapped) return res.status(mapped.status).json({ error: mapped.message });
  console.error("[tickets]", error);
  return res.status(500).json({ error: "Something went wrong." });
}

const id = (v: unknown) => String(v);

router.get("/counts", async (req, res) => {
  try {
    res.json(await tickets.getTicketCounts(req.user!.userId));
  } catch (e) {
    fail(res, e);
  }
});

router.get("/", async (req, res) => {
  try {
    const list = await tickets.listTickets(req.user!.userId, {
      scope: req.query.scope ? String(req.query.scope) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ tickets: list });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/", async (req, res) => {
  try {
    const ticket = await tickets.createTicket(req.user!.userId, req.body ?? {});
    res.status(201).json({ ticket });
  } catch (e) {
    fail(res, e);
  }
});

router.get("/:id", async (req, res) => {
  try {
    res.json({ ticket: await tickets.getTicket(req.user!.userId, id(req.params.id)) });
  } catch (e) {
    fail(res, e);
  }
});

router.post("/:id/messages", async (req, res) => {
  try {
    const body = String(req.body?.body ?? "");
    const isInternal = req.body?.isInternal === true;
    res.json(await tickets.addMessage(req.user!.userId, id(req.params.id), body, isInternal));
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    res.json(await tickets.updateTicket(req.user!.userId, id(req.params.id), req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

// Approve and write an attendance correction to the work session.
router.post("/:id/apply", async (req, res) => {
  try {
    res.json(await tickets.applyCorrection(req.user!.userId, id(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

export default router;