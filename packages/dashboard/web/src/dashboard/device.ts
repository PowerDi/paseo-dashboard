import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeviceInfo } from "@getpaseo/dashboard-shared";

const INSTALLATION_ID_KEY = "paseo-dashboard:installation-id";
let fallbackInstallationId: string | null = null;

export async function getDashboardDeviceInfo(): Promise<DeviceInfo> {
  let installationId = fallbackInstallationId;

  try {
    installationId = installationId ?? (await AsyncStorage.getItem(INSTALLATION_ID_KEY));
    if (!installationId) {
      installationId = createInstallationId();
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, installationId);
    }
  } catch {
    installationId = installationId ?? createInstallationId();
  }

  fallbackInstallationId = installationId;
  return {
    installationId,
    name: describeBrowser(),
    platform: "web",
  };
}

function createInstallationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function describeBrowser(): string {
  const userAgent = globalThis.navigator?.userAgent ?? "";
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/")) return "Chrome";
  if (userAgent.includes("Safari/")) return "Safari";
  return "Dashboard Web";
}
