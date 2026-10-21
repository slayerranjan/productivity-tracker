// ===========================================================================
// TASK ROUTES
//
// /api/tasks        — the employee's own list
// /api/tasks/review — the manager's approval and grading queue
// ===========================================================================

import { Router } from "express";
import * as tasks from "./tasks.service.js";

const router = Router();

const MESSAGES: Record<string, { status: number; message: string }> = {
  USER_NOT_FOUND: { status: 404, message: "Not signed in." },
  NOT_FOUND: { status: 404, message: "That task doesn't exist." },
  FORBIDDEN: { status: 403, message: "Only managers can do that." },
  NOT_YOUR_TEAM: { status: 403, message: "That person isn't in your team." },
  MISSING_FIELDS: { status: 400, message: "A title is required." },
  BAD_STATUS: { status: 400, message: "That isn't a valid status." },
  BAD_OUTCOME: { status: 400, message: "Pick completed, partial or failed." },
  NOT_APPROVED: { status: 400, message: "That task hasn't been approved yet." },
  NOT_FINISHED: { status: 400, message: "It hasn't been marked done yet." },
  ALREADY_DECIDED: { status: 409, message: "That proposal was already decided." },
  ALREADY_REVIEWED: { status: 409, message: "Your manager has already graded that." },
  APPROVED_CANNOT_DELETE: {
    status: 400,
    message: "Approved work can't be deleted. Ask your manager to cancel it.",
  },
  REASON_REQUIRED: { status: 400, message: "Say why you're rejecting it." },
};

function fail(res: any, error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const mapped = MESSAGES[code];
  if (mapped) return res.status(mapped.status).json({ error: mapped.message });
  console.error("[tasks]", error);
  return res.status(500).json({ error: "Something went wrong." });
}

const id = (v: unknown) => String(v);

// --- employee ---------------------------------------------------------------

router.get("/", async (req, res) => {
  try {
    res.json(await tasks.listTasks(req.user!.userId));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/", async (req, res) => {
  try {
    res.json(await tasks.proposeTask(req.user!.userId, req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    res.json(await tasks.updateMyTask(req.user!.userId, id(req.params.id), req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    res.json(await tasks.deleteMyTask(req.user!.userId, id(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

// --- manager ----------------------------------------------------------------
// These sit under /review so they can never collide with a task id in the
// routes above.

router.get("/review/queue", async (req, res) => {
  try {
    res.json(await tasks.listForApproval(req.user!.userId));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/review/assign", async (req, res) => {
  try {
    res.json(await tasks.assignTask(req.user!.userId, req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/review/:id/approve", async (req, res) => {
  try {
    const approve = req.body?.approve === true;
    const note = req.body?.rejectionNote ? String(req.body.rejectionNote) : undefined;
    res.json(await tasks.approveTask(req.user!.userId, id(req.params.id), approve, note));
  } catch (e) {
    fail(res, e);
  }
});

router.post("/review/:id/outcome", async (req, res) => {
  try {
    const outcome = String(req.body?.outcome ?? "");
    const note = req.body?.reviewNote ? String(req.body.reviewNote) : undefined;
    res.json(await tasks.reviewTask(req.user!.userId, id(req.params.id), outcome, note));
  } catch (e) {
    fail(res, e);
  }
});

export default router;