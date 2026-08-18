export { DashboardAccountSection, type DashboardAccountSectionProps } from "./account-section";
export {
  DashboardApiClient,
  DashboardApiError,
  DashboardApiUnauthorizedError,
  dashboardApi,
  type DashboardApi,
  type DashboardApiClientOptions,
  type DashboardRequestOptions,
  type DashboardUnauthorizedHandler,
} from "./api-client";
export { getDashboardDeviceInfo } from "./device";
export {
  buildDashboardHostImport,
  createDashboardIdempotencyKey,
  pairDashboardHost,
  parseDashboardPairingLink,
  type DashboardPairingInput,
  type DashboardPairingVerification,
  type DashboardPairingVerifier,
  type NormalizedDashboardOffer,
} from "./pairing";
export {
  DashboardSessionProvider,
  useDashboardSession,
  useDashboardSessionSnapshot,
  useDashboardSessionStore,
  type DashboardSessionProviderProps,
  type DashboardSessionValue,
} from "./session-provider";
export {
  DashboardAuthenticatedRoot,
  DashboardLoginGate,
  type DashboardAuthenticatedRootProps,
  type DashboardLoginGateProps,
} from "./login-gate";
export {
  DashboardLoginScreen,
  DashboardSessionErrorScreen,
  DashboardSessionLoadingScreen,
} from "./login-screen";
export {
  DashboardAuthenticationRequiredError,
  DashboardSessionStore,
  createDashboardSessionStore,
  dashboardSessionStore,
  type DashboardAuthAction,
  type DashboardAuthStatus,
  type DashboardHostsStatus,
  type DashboardSessionSnapshot,
  type DashboardSessionStoreOptions,
} from "./session-store";
