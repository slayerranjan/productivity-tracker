import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as holidays from "./holidays.service.js";
import { guardUuidParams, isBadInput } from "../../lib/params.js";

const router = Router();
guardUuidParams(router);

function fail(
  res: { status: (n: number) => { json: (b: unknown) => void } },
  err: unknown
) {
  if (isBadInput(err)) {
    res.status(400).json({ error: "One of the values sent is not valid." });
    return;
  }
  const code = err instanceof Error ? err.message : "UNKNOWN";
  // Only short error codes (MISSING_FIELDS, NOT_FOUND...) go back to the browser. Anything else is an
  // unexpected failure (for example database error text with file paths): log it, tell the user nothing.
  if (!/^[A-Z][A-Z0-9_:]*$/.test(code)) {
    console.error("[holidays]", err);
    res.status(500).json({ error: "Something went wrong" });
    return;
  }
  const status =
    code === "NOT_ALLOWED" || code === "NOT_YOUR_COMPANY"
      ? 403
      : code === "NOT_FOUND" || code === "USER_NOT_FOUND"
      ? 404
      : 400;
  res.status(status).json({ error: code });
}

router.use(requireAuth, requireRole("HR", "ADMIN"));

router.get("/", async (req, res) => {
  try {
    res.json(await holidays.listHolidays(req.user!.userId, req.query.year));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    res.json(await holidays.addHoliday(req.user!.userId, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

// Both verbs do the same thing. The POST form exists so the frontend needs
// nothing beyond the apiGet/apiPost helpers it already has.
router.post("/:id/delete", async (req, res) => {
  try {
    res.json(
      await holidays.deleteHoliday(req.user!.userId, String(req.params.id))
    );
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    res.json(
      await holidays.deleteHoliday(req.user!.userId, String(req.params.id))
    );
  } catch (err) {
    fail(res, err);
  }
});

export default router;