import type { AuthenticatedUser, LoginRequest } from "@vicam/contracts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  getSessionCsrfToken,
  onSessionExpired,
  purgeLocalCaches,
  recoverSession,
  refreshSession,
  setSessionTokens,
  unwrap,
} from "../api/api";
import { offlineEnabled } from "../offline/config";
import { hasOfflineAuthorization, purgeOfflineData, unlockOfflineVault } from "../offline/vault";

interface SessionContextValue {
  expired: boolean;
  changePassword: (request: { currentPassword: string; newPassword: string }) => Promise<void>;
  loading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  offlineAvailable: boolean;
  offlineMode: boolean;
  unlockOffline: (pin: string) => Promise<void>;
  user: AuthenticatedUser | null;
}
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) {
      void hasOfflineAuthorization()
        .then(setOfflineAvailable)
        .finally(() => setLoading(false));
      return;
    }
    const recoveryCsrf = getSessionCsrfToken();
    if (!recoveryCsrf) {
      setLoading(false);
      return;
    }
    void recoverSession()
      .then((session) => {
        if (!session) return;
        setUser(session.user);
        setExpired(false);
      })
      .catch(() => {
        setSessionTokens(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () =>
      onSessionExpired(() => {
        void purgeOfflineData("session-expired").finally(() => {
          setUser(null);
          setExpired(true);
          window.history.replaceState({}, "", "/login?expired=1");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
      }),
    [],
  );

  useEffect(() => {
    const secure = () => {
      setSessionTokens(null);
      setUser(null);
      setOfflineAvailable(false);
      setOfflineMode(false);
      window.history.replaceState({}, "", "/login");
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
    window.addEventListener("vicam:offline-purged", secure);
    return () => window.removeEventListener("vicam:offline-purged", secure);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      expired,
      async changePassword(request) {
        const result = await api.POST("/auth/change-password", { body: request });
        if (!result.response.ok) unwrap(result);
        const session = await refreshSession();
        if (!session) throw new Error("No fue posible restablecer la sesión.");
        setUser(session.user);
        setExpired(false);
      },
      loading,
      offlineAvailable,
      offlineMode,
      user,
      async login(credentials) {
        const session = unwrap(
          await api.POST("/auth/login", { body: credentials, credentials: "include" }),
        );
        setSessionTokens(session);
        setUser(session.user);
        setExpired(false);
        setOfflineMode(false);
      },
      async logout() {
        const currentCsrf = getSessionCsrfToken();
        try {
          if (currentCsrf)
            await api.POST("/auth/logout", {
              credentials: "include",
              params: { header: { "x-csrf-token": currentCsrf } },
            });
        } finally {
          setSessionTokens(null);
          setUser(null);
          if (offlineEnabled) await purgeOfflineData("logout");
          await purgeLocalCaches();
          if (window.location.pathname !== "/login") {
            window.history.replaceState({}, "", "/login");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        }
      },
      async unlockOffline(pin) {
        const profile = await unlockOfflineVault(pin);
        setUser(profile);
        setOfflineMode(true);
        setExpired(false);
      },
    }),
    [expired, loading, offlineAvailable, offlineMode, user],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider requerido");
  return value;
}
