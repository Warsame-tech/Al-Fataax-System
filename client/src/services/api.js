/*
 * Small fetch wrapper for the Faatix Node.js API.
 * In development Vite proxies /api and /uploads to http://localhost:5000 (see vite.config.js).
 * Set VITE_API_URL in client/.env if the API lives on another domain.
 */
const BASE_URL = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.errors = data.errors || null; // field errors from validation
    this.data = data;                  // extra details, e.g. { product, available } for insufficientStock
  }
}

/** body may be a plain object (sent as JSON) or FormData (multipart, e.g. logo upload). */
export async function apiRequest(path, { method = "GET", body } = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = { "X-Requested-With": "faatix" }; // required by the API for non-GET requests (CSRF)
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      credentials: "include"
    });
  } catch {
    throw new ApiError(0, "serverOffline");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // No JSON code + 5xx usually means the dev proxy couldn't reach the API.
    const fallback = res.status >= 500 ? "serverOffline" : "failed";
    throw new ApiError(res.status, data.code || fallback, data);
  }
  return data;
}

/** Absolute URL for an uploaded file path such as "/uploads/logos/x.png". */
export const fileUrl = (p) => (p ? BASE_URL + p : null);
