/*
 * Faatix — authentication service (frontend stub).
 *
 * The public site talks to auth only through this module, so a real
 * backend can be connected later without touching the pages:
 *   1. Set FaatixAuth.config.endpoint to the sign-in API URL.
 *   2. Adjust signIn() to match the API's request/response shape.
 *   3. Set config.redirectTo to the dashboard route once it exists.
 */
(function () {
  var SESSION_KEY = "faatix.session";

  var config = {
    endpoint: null,          // e.g. "https://api.faatix.example/auth/sign-in"
    redirectTo: null         // e.g. "dashboard.html"
  };

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  /** @returns {Promise<{ok: boolean, code?: string, session?: object}>} */
  function signIn(credentials) {
    if (!credentials.email || !credentials.password) return Promise.resolve({ ok: false, code: "required" });
    if (!isValidEmail(credentials.email)) return Promise.resolve({ ok: false, code: "invalidEmail" });

    if (!config.endpoint) {
      // No backend yet — simulate latency so the loading state can be seen.
      return new Promise(function (resolve) {
        setTimeout(function () { resolve({ ok: false, code: "notConnected" }); }, 700);
      });
    }

    return fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      credentials: "include"
    }).then(function (res) {
      if (!res.ok) return { ok: false, code: "failed" };
      return res.json().then(function (session) {
        saveSession(session, credentials.remember);
        return { ok: true, session: session };
      });
    }).catch(function () {
      return { ok: false, code: "failed" };
    });
  }

  function saveSession(session, remember) {
    try {
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) { /* ignore */ }
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function signOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  window.FaatixAuth = {
    config: config,
    signIn: signIn,
    getSession: getSession,
    signOut: signOut,
    isValidEmail: isValidEmail
  };
})();
