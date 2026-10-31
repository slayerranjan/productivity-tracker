import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { isBadInput } from "../../lib/params.js";
import * as preferences from "./preferences.service.js";

const router = Router();

// Every service error code needs an entry here, otherwise it becomes a 500.
const MESSAGES: Record<string, { status: number; message: string }> = {
  BAD_THEME: { status: 400, message: "Choose LIGHT or DARK." },
  FEATURES_NOT_READY: { status: 503, message: "Saving your choice to your account isn't switched on yet." },
};

function fail(res: Response, error: unknown) {
  if (isBadInput(error)) {
    res.status(400).json({ error: "One of the values sent is not valid." });
    return;
  }
  const known = MESSAGES[error instanceof Error ? error.message : "UNKNOWN"];
  if (known) return res.status(known.status).json({ error: known.message });
  console.error("Preferences error:", error);
  return res.status(500).json({ error: "Something went wrong" });
}

const run = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    fail(res, e);
  }
};

// Everyone signed in, every role, including people still on the first-login password screen. Always their OWN row.
router.use(requireAuth);
router.get("/", run((req) => preferences.get(req.user!.userId)));
router.patch("/", run((req) => preferences.setTheme(req.user!.userId, req.body?.theme)));

export default router;
