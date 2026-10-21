import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { fetchMe, signOut as apiSignOut } from "../services/authService.js";

const AuthContext = createContext(null);

/** Holds the signed-in user + business (from GET /api/auth/me). */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, business: null, trial: null });

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setState({ status: "signedIn", ...me });
      return true;
    } catch {
      setState({ status: "signedOut", user: null, business: null, trial: null });
      return false;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setState({ status: "signedOut", user: null, business: null, trial: null });
  }, []);

  return <AuthContext.Provider value={{ ...state, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Wrap protected routes. The API enforces access too — this only handles navigation. */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="app-loading" role="status"><span className="app-spinner" /></div>;
  if (status !== "signedIn") return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return children;
}
