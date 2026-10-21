import { Router } from "express";
import { checkDatabase } from "../config/db.js";

const router = Router();

// GET /api/health — quick check that the API and MySQL are reachable.
router.get("/", async (req, res) => {
  const database = await checkDatabase();
  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? "ok" : "degraded",
    api: "ok",
    database: database.ok ? "connected" : `unavailable (${database.error})`,
    time: new Date().toISOString()
  });
});

export default router;
