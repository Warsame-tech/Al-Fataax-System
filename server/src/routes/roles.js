import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm, PERMISSION_GROUPS, OWNER_ONLY, normalizePermissions } from "../lib/permissions.js";
import { ensureDefaultRoles, parsePermissions } from "../lib/roles.js";
import { ah, text, optText, id, withTx, ensureOwned, badRequest, conflict } from "../lib/http.js";

/*
 * Business roles (Staff & roles → Roles / Module access). Owner only.
 * A role is a name, a short description and the permissions it gives (grouped by module).
 * Owner-only permissions (staff, business info, settings) can never be added to a role.
 */
const router = Router();
router.use(requireAuth, requirePerm("staff.manage"));

const shape = (r) => ({
  id: r.id, name: r.name, description: r.description || "", templateKey: r.template_key || null,
  permissions: parsePermissions(r.permissions), staffCount: Number(r.staff_count || 0)
});

/* GET /api/roles → { roles, catalog: { groups, ownerOnly } } */
router.get("/", ah(async (req, res) => {
  const bid = req.business.id;
  await ensureDefaultRoles(bid);
  const [rows] = await pool.query(
    `SELECT ro.*, (SELECT COUNT(*) FROM business_user_roles bur WHERE bur.business_id = ro.business_id AND bur.role_id = ro.id) staff_count
       FROM roles ro WHERE ro.business_id = ? ORDER BY ro.created_at, ro.id`, [bid]);
  res.json({ roles: rows.map(shape), catalog: { groups: PERMISSION_GROUPS, ownerOnly: OWNER_ONLY } });
}));

function readRole(body) {
  const d = { name: text(body.name, 60), description: optText(body.description, 200), permissions: normalizePermissions(body.permissions) };
  if (!d.name) throw badRequest({ name: "required" });
  return d;
}
const duplicate = (err) => (err.code === "ER_DUP_ENTRY" ? badRequest({ name: "roleNameTaken" }) : err);

router.post("/", ah(async (req, res) => {
  const d = readRole(req.body || {});
  const bid = req.business.id;
  await ensureDefaultRoles(bid);
  try {
    const newId = await withTx(async (conn) => {
      const [r] = await conn.query("INSERT INTO roles (business_id, name, description, permissions) VALUES (?, ?, ?, ?)",
        [bid, d.name, d.description, JSON.stringify(d.permissions)]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: "role.created", entity: "role", entityId: r.insertId, meta: { name: d.name, permissions: d.permissions.length }, ip: req.ip });
      return r.insertId;
    });
    res.status(201).json({ id: newId });
  } catch (err) { throw duplicate(err); }
}));

/* PUT /api/roles/:id { name, description, permissions } — takes effect on the staff's next click */
router.put("/:id", ah(async (req, res) => {
  const d = readRole(req.body || {});
  const bid = req.business.id;
  try {
    await withTx(async (conn) => {
      const r = await ensureOwned(conn, "roles", id(req.params.id), bid, true);
      await conn.query("UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ? AND business_id = ?",
        [d.name, d.description, JSON.stringify(d.permissions), r.id, bid]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: "role.updated", entity: "role", entityId: r.id, meta: { name: d.name, permissions: d.permissions }, ip: req.ip });
    });
    res.json({ code: "saved" });
  } catch (err) { throw duplicate(err); }
}));

/* DELETE /api/roles/:id — only when no staff member uses it */
router.delete("/:id", ah(async (req, res) => {
  const bid = req.business.id;
  await withTx(async (conn) => {
    const r = await ensureOwned(conn, "roles", id(req.params.id), bid, true);
    const [[used]] = await conn.query("SELECT COUNT(*) n FROM business_user_roles WHERE business_id = ? AND role_id = ?", [bid, r.id]);
    if (used.n) throw conflict("roleInUse", { count: Number(used.n) });
    await conn.query("DELETE FROM roles WHERE id = ? AND business_id = ?", [r.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "role.deleted", entity: "role", entityId: r.id, meta: { name: r.name }, ip: req.ip });
  });
  res.json({ code: "deleted" });
}));

export default router;
