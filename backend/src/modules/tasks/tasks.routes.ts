import { Router, type Response } from "express";
import * as tasks from "./tasks.service.js";
import { requireAuth } from "../../middlewares/auth.js";

const router = Router();
router.use(requireAuth);

const MESSAGES: Record<string, { status: number; message: string }> = {
  USER_NOT_FOUND: { status: 404, message: "User not found" },
  TASK_NOT_FOUND: { status: 404, message: "Task not found" },
  NOT_YOURS: { status: 403, message: "That task is not yours" },
};

function fail(res: Response, error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known = MESSAGES[code];
  if (known) return res.status(known.status).json({ error: known.message });
  console.error("Tasks error:", error);
  return res.status(500).json({ error: "Something went wrong" });
}

const WEIGHTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

router.get("/", async (req, res) => {
  try {
    res.json(await tasks.listTasks(req.user!.userId));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/", async (req, res) => {
  const { title, weight, description } = req.body ?? {};

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Give the task a title" });
  }
  if (!WEIGHTS.includes(weight)) {
    return res.status(400).json({ error: "Pick a valid weight" });
  }

  try {
    res.json(
      await tasks.createTask(req.user!.userId, title, weight, description)
    );
  } catch (error) {
    fail(res, error);
  }
});

router.patch("/:id", async (req, res) => {
  const { status, title, weight } = req.body ?? {};

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Pick a valid status" });
  }
  if (weight && !WEIGHTS.includes(weight)) {
    return res.status(400).json({ error: "Pick a valid weight" });
  }

  try {
    res.json(
      await tasks.updateTask(req.user!.userId, String(req.params.id), {
        status,
        title,
        weight,
      })
    );
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    res.json(await tasks.deleteTask(req.user!.userId, String(String(req.params.id))));
  } catch (error) {
    fail(res, error);
  }
});

export default router;