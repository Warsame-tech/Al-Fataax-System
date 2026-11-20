import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../config/db.js";
import { platformSettings } from "../lib/platform.js";

const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, handler: (req, res) => res.status(429).json({ code: "tooManyAttempts" }) });
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/*
 * POST /api/contact { name, email?, phone?, message } — the website's "Send us a message" form.
 * Saved for the super admin (Support → Website messages); 5 messages an hour per visitor.
 */
router.post("/", limiter, async (req, res, next) => {
  try {
    const name = clean(req.body?.name, 120);
    const email = clean(req.body?.email, 190);
    const phone = clean(req.body?.phone, 40);
    const message = clean(req.body?.message, 4000);
    const errors = {};
    if (!name) errors.name = "required";
    if (!message) errors.message = "required";
    if (!email && !phone) errors.phone = "emailOrPhone";
    if (email && !EMAIL.test(email)) errors.email = "invalidEmail";
    if (Object.keys(errors).length) return res.status(400).json({ code: "validation", errors });
    await pool.query("INSERT INTO contact_messages (name, email, phone, message, ip) VALUES (?, ?, ?, ?, ?)", [name, email || null, phone || null, message, req.ip]);
    res.status(201).json({ code: "sent" });
  } catch (err) { next(err); }
});

/* GET /api/contact/platform — what the website shows: contact details and the business types open for sign-up */
router.get("/platform", async (req, res, next) => {
  try {
    const s = await platformSettings();
    res.json({ contact: s.contact, disabledTypes: s.disabledTypes, trialDays: s.trialDays });
  } catch (err) { next(err); }
});

export default router;
