import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import * as projects from "./projects.service.js";

const router = Router();

function fail(
  res: { status: (n: number) => { json: (b: unknown) => void } },
  err: unknown
) {
  const code = err instanceof Error ? err.message : "UNKNOWN";
  const status =
    code === "NOT_ALLOWED" || code === "NOT_YOUR_COMPANY"
      ? 403
      : code === "NOT_FOUND" ||
        code === "USER_NOT_FOUND" ||
        code === "MANAGER_NOT_FOUND" ||
        code === "NOT_A_MEMBER"
      ? 404
      : 400;
  res.status(status).json({ error: code });
}

router.use(requireAuth);

// Managers may read the projects they run; the service decides.
router.get("/", async (req, res) => {
  try {
    res.json(await projects.listProjects(req.user!.userId));
  } catch (err) {
    fail(res, err);
  }
});

router.use(requireRole("HR", "ADMIN"));

router.post("/", async (req, res) => {
  try {
    res.json(await projects.saveProject(req.user!.userId, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:id/members", async (req, res) => {
  try {
    res.json(
      await projects.addMember(
        req.user!.userId,
        String(req.params.id),
        req.body ?? {}
      )
    );
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:id/members/:userId/primary", async (req, res) => {
  try {
    res.json(
      await projects.makePrimary(
        req.user!.userId,
        String(req.params.id),
        String(req.params.userId)
      )
    );
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:id/members/:userId/remove", async (req, res) => {
  try {
    res.json(
      await projects.removeMember(
        req.user!.userId,
        String(req.params.id),
        String(req.params.userId)
      )
    );
  } catch (err) {
    fail(res, err);
  }
});

export default router;