/*
 * Authentication service — the only place the UI talks to the auth API.
 * The session itself is an httpOnly cookie set by the server; nothing
 * sensitive is stored in the browser.
 */
import { apiRequest } from "./api.js";

const fail = (err) => ({ ok: false, code: err.code || "failed", errors: err.errors || null });

/** @returns {Promise<{ok: boolean, code?: string}>} */
export async function signIn({ username, password }) {
  if (!username || !password) return { ok: false, code: "required" };
  try {
    await apiRequest("/api/auth/sign-in", { method: "POST", body: { username, password } });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** form: FormData built by the registration page (includes the optional logo file). */
export async function register(form) {
  try {
    await apiRequest("/api/auth/register", { method: "POST", body: form });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function fetchMe() {
  return apiRequest("/api/auth/me");
}

export async function signOut() {
  try { await apiRequest("/api/auth/sign-out", { method: "POST" }); } catch { /* ignore */ }
}

export async function saveLanguage(language) {
  try { await apiRequest("/api/auth/language", { method: "PATCH", body: { language } }); } catch { /* ignore */ }
}
