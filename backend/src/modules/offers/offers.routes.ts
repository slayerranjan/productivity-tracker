import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as offers from "./offers.service.js";
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
    console.error("[offers]", err);
    res.status(500).json({ error: "Something went wrong" });
    return;
  }
  const status =
    code === "NOT_ALLOWED" || code === "NOT_YOUR_COMPANY"
      ? 403
      : code === "NOT_FOUND" || code === "CANDIDATE_NOT_FOUND" || code === "USER_NOT_FOUND"
      ? 404
      : 400;
  res.status(status).json({ error: code });
}

router.use(requireAuth);

// --- the candidate's own offer --------------------------------------------
router.get("/me", async (req, res) => {
  try {
    res.json(await offers.myOffer(req.user!.userId));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/me/:id/respond", async (req, res) => {
  try {
    // Behind a proxy, the real address is in x-forwarded-for.
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0];
    const ip = forwarded.trim() || req.ip || null;

    res.json(
      await offers.respondToOffer(
        req.user!.userId,
        String(req.params.id),
        req.body?.accept !== false,
        ip,
        req.body?.reason ? String(req.body.reason) : undefined
      )
    );
  } catch (err) {
    fail(res, err);
  }
});

// --- HR -------------------------------------------------------------------
router.use(requireRole("HR", "ADMIN"));

router.get("/templates", async (req, res) => {
  try {
    res.json(await offers.listTemplates(req.user!.userId));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/templates", async (req, res) => {
  try {
    res.json(await offers.saveTemplate(req.user!.userId, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    res.json(await offers.createOffer(req.user!.userId, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    res.json(await offers.previewOffer(req.user!.userId, String(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:id/send", async (req, res) => {
  try {
    res.json(await offers.sendOffer(req.user!.userId, String(req.params.id)));
  } catch (err) {
    fail(res, err);
  }
});

export default router;