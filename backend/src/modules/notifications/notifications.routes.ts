import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { guardUuidParams, isBadInput } from "../../lib/params.js";
import * as notifications from "./notifications.service.js";

const router = Router();
guardUuidParams(router);

function fail(res: Response, error: unknown) {
  if (isBadInput(error)) {
    res.status(400).json({ error: "One of the values sent is not valid." });
    return;
  }
  console.error("Notifications error:", error);
  res.status(500).json({ error: "Something went wrong" });
}

const run = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    fail(res, e);
  }
};

router.use(requireAuth);
router.get("/", run((req) => notifications.listMine(req.user!.userId)));
router.post("/read-all", run((req) => notifications.markAllRead(req.user!.userId)));
router.post("/:id/read", run((req) => notifications.markRead(req.user!.userId, String(req.params.id))));

export default router;
