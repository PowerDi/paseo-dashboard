import React, { useCallback, type PropsWithChildren, type ReactNode } from "react";
import {
  DashboardLoginScreen,
  DashboardSessionErrorScreen,
  DashboardSessionLoadingScreen,
} from "./login-screen";
import {
  DashboardSessionProvider,
  type DashboardSessionProviderProps,
  useDashboardSession,
} from "./session-provider";
import type { DashboardSessionStore } from "./session-store";

function DashboardSessionErrorContent({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  const retry = useCallback(() => void onRetry(), [onRetry]);
  return <DashboardSessionErrorScreen message={message} onRetry={retry} />;
}

export interface DashboardLoginGateProps extends PropsWithChildren {
  loadingFallback?: ReactNode;
  anonymousFallback?: ReactNode;
  errorFallback?: (message: string, retry: () => Promise<void>) => ReactNode;
}

export function DashboardLoginGate({
  children,
  loadingFallback,
  anonymousFallback,
  errorFallback,
}: DashboardLoginGateProps) {
  const session = useDashboardSession();

  if (session.authStatus === "checking") {
    return loadingFallback ?? <DashboardSessionLoadingScreen />;
  }

  if (session.authStatus === "error") {
    return (
      errorFallback?.(session.authError ?? "Dashboard 暂时无法连接", session.bootstrap) ?? (
        <DashboardSessionErrorContent
          message={session.authError ?? "Dashboard 暂时无法连接"}
          onRetry={session.bootstrap}
        />
      )
    );
  }

  if (session.authStatus === "anonymous") {
    return anonymousFallback ?? <DashboardLoginScreen />;
  }

  return children;
}

export interface DashboardAuthenticatedRootProps extends DashboardLoginGateProps {
  store?: DashboardSessionStore;
  autoBootstrap?: DashboardSessionProviderProps["autoBootstrap"];
}

/**
 * Root-layout integration point. It keeps all App runtime children behind the cookie session probe.
 */
export function DashboardAuthenticatedRoot({
  store,
  autoBootstrap,
  children,
  loadingFallback,
  anonymousFallback,
  errorFallback,
}: DashboardAuthenticatedRootProps) {
  return (
    <DashboardSessionProvider store={store} autoBootstrap={autoBootstrap}>
      <DashboardLoginGate
        loadingFallback={loadingFallback}
        anonymousFallback={anonymousFallback}
        errorFallback={errorFallback}
      >
        {children}
      </DashboardLoginGate>
    </DashboardSessionProvider>
  );
}
