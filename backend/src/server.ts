import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "./lib/prisma.js";
import authRoutes from "./modules/auth/auth.routes.js";
import trackerRoutes from "./modules/tracker/tracker.routes.js";
import taskRoutes from "./modules/tasks/tasks.routes.js";
import reportRoutes from "./modules/reports/reports.routes.js";
import { startTrackerScheduler } from "./modules/tracker/tracker.scheduler.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 5001);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

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

app.use("/api/tracker", trackerRoutes);

app.use("/api/reports", reportRoutes);
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`Tracker backend listening on http://localhost:${PORT}`);
  startTrackerScheduler();
});