import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/auth.js";
import * as policies from "./policies.service.js";
import { guardUuidParams, isBadInput } from "../../lib/params.js";

const router = Router();
guardUuidParams(router);

// Every service error code needs an entry here, otherwise it becomes a 500.
const MESSAGES: Record<string, { status: number; message: string }> = {
  NOT_ALLOWED: { status: 403, message: "Only HR and Admin can do that." },
  NOT_FOUND: { status: 404, message: "That document was not found." },
  USER_NOT_FOUND: { status: 404, message: "User not found." },
  TEAM_NOT_FOUND: { status: 404, message: "That team doesn't exist in your company." },
  BAD_CATEGORY: { status: 400, message: "Pick a valid category." },
  TITLE_REQUIRED: { status: 400, message: "Give the document a title." },
  TITLE_TOO_LONG: { status: 400, message: "That title is too long." },
  FILE_REQUIRED: { status: 400, message: "Attach a file." },
  UNSUPPORTED_FILE_TYPE: { status: 415, message: "Upload a PDF, JPG, PNG, WEBP or Word file." },
  EMPTY_FILE: { status: 400, message: "That file is empty." },
  FILE_TOO_LARGE: { status: 413, message: "That file is too large (10 MB maximum)." },
  OPEN_FIRST: { status: 400, message: "Open the document first, then confirm you have read it." },
};

function fail(res: Response, error: unknown) {
  if (isBadInput(error)) {
    res.status(400).json({ error: "One of the values sent is not valid." });
    return;
  }
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known = MESSAGES[code];
  if (known) return res.status(known.status).json({ error: known.message });
  console.error("Policies error:", error);
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
const pid = (req: Request) => String(req.params.id);

router.use(requireAuth);

// Everyone
router.get("/", run((req) => policies.listMine(uid(req))));
router.post("/:id/acknowledge", run((req) => policies.acknowledge(uid(req), pid(req))));
router.get("/:id/file", async (req, res) => {
  try {
    const file = await policies.openFile(uid(req), pid(req));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "no-store, private");
    res.send(file.buffer);
  } catch (e) {
    fail(res, e);
  }
});

// HR / Admin (the service checks the role and the company)
router.get("/manage", run((req) => policies.manageList(uid(req))));
router.post("/", run((req) => policies.createDocument(uid(req), req.body ?? {})));
router.post("/:id/file", run((req) => policies.replaceFile(uid(req), pid(req), req.body ?? {})));
router.post("/:id/archive", run((req) => policies.setActive(uid(req), pid(req), false)));
router.post("/:id/restore", run((req) => policies.setActive(uid(req), pid(req), true)));
router.get("/:id/report", run((req) => policies.report(uid(req), pid(req))));

export default router;
