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
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  trialDays: Number(process.env.TRIAL_DAYS) || 15,
  db: dbConfig()
};
