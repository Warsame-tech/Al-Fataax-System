import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to a long random value in production.");
}

/*
 * Database settings. Our own DB_* variables win; otherwise the hosting provider's
 * MySQL variables are used (Railway: MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD,
 * MYSQLDATABASE, or a single MYSQL_URL / DATABASE_URL like mysql://user:pass@host:port/db).
 */
function dbConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  let fromUrl = {};
  if (url && /^mysql:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      fromUrl = {
        host: u.hostname, port: u.port, user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, "")
      };
    } catch { /* ignore a malformed URL */ }
  }
  const pick = (...values) => values.find((v) => v !== undefined && v !== null && v !== "");
  return {
    host: pick(process.env.DB_HOST, process.env.MYSQLHOST, fromUrl.host) || "localhost",
    port: Number(pick(process.env.DB_PORT, process.env.MYSQLPORT, fromUrl.port)) || 3306,
    user: pick(process.env.DB_USER, process.env.MYSQLUSER, fromUrl.user) || "root",
    password: pick(process.env.DB_PASSWORD, process.env.MYSQLPASSWORD, fromUrl.password) || "",
    database: pick(process.env.DB_NAME, process.env.MYSQLDATABASE, fromUrl.database) || "faatix"
  };
}

export const env = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  // the public website(s) allowed to call the contact endpoints, comma separated (e.g. https://faatix.com,https://www.faatix.com)
  websiteOrigins: (process.env.WEBSITE_ORIGIN || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5174")).split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  trialDays: Number(process.env.TRIAL_DAYS) || 15,
  db: dbConfig(),
  /* ---- multi-tenancy (lib/tenancy.js, lib/provisioning.js) ---- */
  // businesses open at <slug>.<BASE_DOMAIN>, e.g. prodima.faatix.com (empty: only /b/<slug> links and custom domains)
  baseDomain: (process.env.BASE_DOMAIN || "").trim().toLowerCase().replace(/^\.+|\/+$/g, ""),
  // key that encrypts the per-business database passwords (AES-256-GCM). Required in production for own databases.
  tenantDbKey: process.env.TENANT_DB_KEY || "",
  // "dedicated" (own database per new business, default) or "shared" (new businesses use the central database)
  tenantDbMode: process.env.TENANT_DB_MODE === "shared" ? "shared" : "dedicated",
  // create a separate, restricted MySQL user per business database (needs CREATE USER / GRANT); "false" = reuse the main user
  tenantDbUsers: process.env.TENANT_DB_USERS !== "false",
  // the host the per-business MySQL users may connect from ('%' = anywhere; set e.g. 10.% on a private network)
  tenantDbUserHost: process.env.TENANT_DB_USER_HOST || "%",
  // where backups are written (JSON + gzip). On Railway mount a volume here.
  backupDir: process.env.BACKUP_DIR || ""
};
