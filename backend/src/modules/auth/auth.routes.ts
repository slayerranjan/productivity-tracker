import { Router } from "express";
import * as authService from "./auth.service.js";
import { requireAuth } from "../../middlewares/auth.js";
import { loginLimiter, clearLoginAttempts } from "../../middlewares/rateLimit.js";

const router = Router();

// Brute-force guard on the credential check only (it ignores other paths).
router.use(loginLimiter);

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await authService.login(email, password);
    clearLoginAttempts(req);
    return res.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";

    if (code === "INVALID_CREDENTIALS") {
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if (code === "ACCOUNT_INACTIVE") {
      return res.status(403).json({ error: "This account is no longer active" });
    }

    console.error("Login failed:", error);
    return res.status(500).json({ error: "Something went wrong signing in" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const me = await authService.getMe(req.user!.userId);

  if (!me) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(me);
});

export default router;