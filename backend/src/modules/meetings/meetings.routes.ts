import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { guardUuidParams, isBadInput } from "../../lib/params.js";
import * as meetings from "./meetings.service.js";

const router = Router();
guardUuidParams(router);

// Every service error code needs an entry here, otherwise it becomes a 500.
const MESSAGES: Record<string, { status: number; message: string }> = {
  NOT_ALLOWED: { status: 403, message: "You don't have permission to do that." },
  NOT_FOUND: { status: 404, message: "That meeting was not found." },
  USER_NOT_FOUND: { status: 404, message: "User not found." },
  BAD_DATE: { status: 400, message: "The date must be a real day in YYYY-MM-DD format." },
  BAD_TIME: { status: 400, message: "Times must look like 14:30 (24-hour)." },
  BAD_RANGE: { status: 400, message: "The meeting must end after it starts, on the same day." },
  TOO_LONG: { status: 400, message: "A meeting can be at most 12 hours long." },
  PAST_MEETING: { status: 400, message: "A meeting can't be scheduled in the past." },
  BAD_URL: { status: 400, message: "Paste a full https link (for example from Google Meet, Teams or Zoom)." },
  TITLE_REQUIRED: { status: 400, message: "Give the meeting a title." },
  TITLE_TOO_LONG: { status: 400, message: "Keep the title under 120 characters." },
  DESCRIPTION_TOO_LONG: { status: 400, message: "Keep the description under 1000 characters." },
  ATTENDEES_REQUIRED: { status: 400, message: "Choose at least one person to invite." },
  TOO_MANY: { status: 400, message: "You can invite at most 100 people." },
  ATTENDEE_NOT_FOUND: { status: 400, message: "Everyone invited must be an active person in your company." },
  MEETING_CANCELLED: { status: 409, message: "This meeting has already been cancelled." },
  MEETING_OVER: { status: 409, message: "This meeting has already ended." },
};

function fail(res: Response, error: unknown) {
  if (isBadInput(error)) {
    res.status(400).json({ error: "One of the values sent is not valid." });
    return;
  }
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known = MESSAGES[code];
  if (known) return res.status(known.status).json({ error: known.message });
  console.error("Meetings error:", error);
  return res.status(500).json({ error: "Something went wrong" });
}

const run = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    fail(res, e);
  }
};
const uid = (req: Request) => req.user!.userId;

router.use(requireAuth);

router.get("/", run((req) => meetings.listMine(uid(req), { scope: req.query.scope, q: req.query.q })));
router.get("/oversight", run((req) => meetings.oversight(uid(req), { scope: req.query.scope })));
router.get("/people", run((req) => meetings.people(uid(req))));
router.get("/:id", run((req) => meetings.getOne(uid(req), String(req.params.id))));
router.post("/", run((req) => meetings.create(uid(req), req.body ?? {})));
router.patch("/:id", run((req) => meetings.update(uid(req), String(req.params.id), req.body ?? {})));
router.post("/:id/cancel", run((req) => meetings.cancel(uid(req), String(req.params.id), req.body?.reason)));

export default router;
