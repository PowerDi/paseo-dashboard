import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import {
  dashboardSessionStore,
  type DashboardSessionSnapshot,
  type DashboardSessionStore,
} from "./session-store";

const DashboardSessionContext = createContext<DashboardSessionStore | null>(null);

export type DashboardSessionValue = DashboardSessionSnapshot &
  Pick<
    DashboardSessionStore,
    | "bootstrap"
    | "login"
    | "register"
    | "logout"
    | "refreshHosts"
    | "importHost"
    | "updateHost"
    | "deleteHost"
    | "replaceHostsSnapshot"
    | "clearAuthError"
  >;

export interface DashboardSessionProviderProps extends PropsWithChildren {
  store?: DashboardSessionStore;
  autoBootstrap?: boolean;
}

export function DashboardSessionProvider({
  children,
  store = dashboardSessionStore,
  autoBootstrap = true,
}: DashboardSessionProviderProps) {
  useEffect(() => {
    if (autoBootstrap) void store.bootstrap();
  }, [autoBootstrap, store]);

  return (
    <DashboardSessionContext.Provider value={store}>{children}</DashboardSessionContext.Provider>
  );
}

export function useDashboardSessionStore(): DashboardSessionStore {
  const store = useContext(DashboardSessionContext);
  if (!store) {
    throw new Error("useDashboardSessionStore must be used inside DashboardSessionProvider");
  }
  return store;
}

export function useDashboardSessionSnapshot(): DashboardSessionSnapshot {
  const store = useDashboardSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useDashboardSession(): DashboardSessionValue {
  const store = useDashboardSessionStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return useMemo(
    () => ({
      ...snapshot,
      bootstrap: store.bootstrap,
      login: store.login,
      register: store.register,
      logout: store.logout,
      refreshHosts: store.refreshHosts,
      importHost: store.importHost,
      updateHost: store.updateHost,
      deleteHost: store.deleteHost,
      replaceHostsSnapshot: store.replaceHostsSnapshot,
      clearAuthError: store.clearAuthError,
    }),
    [snapshot, store],
  );
}
