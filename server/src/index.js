import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { checkDatabase } from "./config/db.js";
import { migrate } from "./config/migrate.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contact.js";
import dashboardRoutes from "./routes/dashboard.js";
import invoiceRoutes from "./routes/invoices.js";
import productRoutes from "./routes/products.js";
import salesRoutes from "./routes/sales.js";
import purchaseRoutes from "./routes/purchases.js";
import reportRoutes from "./routes/reports.js";
import adminRoutes from "./routes/admin.js";
import { customersRouter, suppliersRouter } from "./routes/parties.js";
import { expensesRouter, accountsRouter } from "./routes/money.js";
import { staffRouter, settingsRouter, profileRouter, notificationsRouter, auditRouter } from "./routes/account.js";
import { HttpError } from "./lib/http.js";

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));

app.set("trust proxy", 1); // correct client IP behind a hosting proxy (rate limiting, audit)
app.disable("x-powered-by");
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Basic security headers.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// CSRF: state-changing API calls must carry a custom header. Browsers cannot add it
// cross-site without a CORS preflight (which our CORS policy rejects), and the
// session cookie is SameSite=Strict as a second layer.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "faatix") return res.status(403).json({ code: "forbidden" });
  next();
});

// Uploaded logos (validated on upload; served as static files only).
app.use("/uploads", express.static(path.resolve(here, "../uploads"), { fallthrough: false, index: false }));

// API routes
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/customers", customersRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/money", expensesRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/reports", reportRoutes);
app.use("/api/staff", staffRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/admin", adminRoutes);
app.use("/api", (req, res) => res.status(404).json({ code: "notFound" }));

// In production, serve the built React app (client/dist) from the same server.
const clientDist = path.resolve(here, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// Central error handler — never leaks internals to the client.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ code: err.code, errors: err.errors || undefined, ...(err.extra || {}) });
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(400).json({ code: "validation", errors: { [err.field || "logo"]: err.field === "image" ? "imageTooLarge" : "logoTooLarge" } });
  if (err?.status === 404 || err?.statusCode === 404) return res.status(404).end();
  console.error(err);
  res.status(500).json({ code: "serverError" });
});

app.listen(env.port, async () => {
  console.log(`Faatix API running on http://localhost:${env.port}`);
  const db = await checkDatabase();
  if (db.ok) await migrate().catch((e) => console.error("Database upgrade failed:", e.code || e.message));
  console.log(db.ok
    ? `MySQL connected (database "${env.db.database}")`
    : `MySQL NOT connected: ${db.error} — start MySQL and run "npm run db:init" in /server`);
});
