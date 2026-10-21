import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import authRoutes from "./modules/auth/auth.routes.js";
import trackerRoutes from "./modules/tracker/tracker.routes.js";
import taskRoutes from "./modules/tasks/tasks.routes.js";
import reportRoutes from "./modules/reports/reports.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import ticketRoutes from "./modules/tickets/tickets.routes.js";
import onboardingRoutes from "./modules/onboarding/onboarding.routes.js";
import payrollRoutes from "./modules/payroll/payroll.routes.js";
import holidayRoutes from "./modules/holidays/holidays.routes.js";
import offerRoutes from "./modules/offers/offers.routes.js";
import projectRoutes from "./modules/projects/projects.routes.js";
import { requireAuth } from "./middlewares/auth.js";
import { requireTrackerAccess } from "./middlewares/trackerGate.js";
import { startTrackerScheduler } from "./modules/tracker/tracker.scheduler.js";
import { startOnboardingScheduler } from "./modules/onboarding/onboarding.scheduler.js";
import { audit } from "./middlewares/audit.js";

const app = express();
const PORT = Number(process.env.PORT ?? 5001);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];
app.use(cors({ origin: allowedOrigins, credentials: true }));
// Documents arrive as base64 inside the JSON body, so the default 100kb
// limit is far too small. 20mb covers a 10mb file plus base64's overhead.
app.use(express.json({ limit: "20mb" }));
app.use(audit);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "tracker-backend",
    time: new Date().toISOString(),
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    const count = await prisma.platform.count();
    res.json({ database: "connected", platforms: count });
  } catch (error) {
    res.status(500).json({
      database: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use("/api/auth", authRoutes);

// The gate runs before any tracker route. Someone mid-onboarding can sign
// in and see their checklist, but cannot record a minute of work.
app.use("/api/tracker", requireAuth, requireTrackerAccess, trackerRoutes);
app.use("/api/tasks", requireAuth, requireTrackerAccess, taskRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/projects", projectRoutes);
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Tracker backend listening on http://localhost:${PORT}`);
  startTrackerScheduler();
  startOnboardingScheduler();
});