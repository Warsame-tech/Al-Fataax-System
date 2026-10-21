import { Router } from "express";

const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * POST /api/contact
 * Placeholder: validates the message but does not store or send it yet.
 * Next stage: save to a `contact_messages` table and/or email the team.
 */
router.post("/", (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ code: "required" });
  if (!EMAIL.test(email)) return res.status(400).json({ code: "invalidEmail" });
  return res.status(501).json({ code: "notConnected" });
});

export default router;
