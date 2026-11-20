/*
 * Minimal fetch wrapper for the two API calls the website makes (GET /api/contact/platform, POST /api/contact).
 * VITE_API_URL points at the Faatix API in production; in development Vite proxies /api (vite.config.js).
 * The API must list this website's origin in WEBSITE_ORIGIN (CORS).
 */
const BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export async function apiRequest(path, { method = "GET", body } = {}) {
  const headers = { "X-Requested-With": "faatix" };
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    const err = new Error("serverOffline"); err.data = { code: "serverOffline" }; throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.code || "failed"); err.status = res.status; err.data = data; throw err; }
  return data;
}
