import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import { guardUuidParams, isBadInput } from "../../lib/params.js";
import * as notifications from "./notifications.service.js";

const router = Router();
guardUuidParams(router);

function fail(res: Response, error: unknown) {
  if (error instanceof Error && error.message === "BAD_CURSOR") {
    res.status(400).json({ error: "That page marker is not valid." });
    return;
  }
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
// The notification centre: ?filter=unread, ?before=<createdAt of the last item shown>, ?limit=25
router.get(
  "/page",
  run((req) =>
    notifications.page(req.user!.userId, {
      filter: typeof req.query.filter === "string" ? req.query.filter : undefined,
      before: typeof req.query.before === "string" ? req.query.before.slice(0, 40) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    })
  )
);
router.post("/read-all", run((req) => notifications.markAllRead(req.user!.userId)));
router.post("/:id/read", run((req) => notifications.markRead(req.user!.userId, String(req.params.id))));

export default router;
