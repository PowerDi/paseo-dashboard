import type { Host } from "@getpaseo/dashboard-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Text: "Text",
  View: "View",
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: () => ({ sectionActions: {} }),
  },
}));

vi.mock("../components/ui/button", () => ({ Button: "Button" }));
vi.mock("../runtime/dashboard-host-mutations", () => ({
  replaceRuntimeWithDashboardAccountHosts: vi.fn(),
}));
vi.mock("../screens/settings/settings-section", () => ({ SettingsSection: "SettingsSection" }));
vi.mock("../styles/settings", () => ({
  settingsStyles: {
    card: {},
    row: {},
    rowBorder: {},
    rowContent: {},
    rowTitle: {},
    rowHint: {},
    rowError: {},
  },
}));
vi.mock("../utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("./session-provider", () => ({ useDashboardSession: vi.fn() }));

import { deleteDashboardAccountHost } from "./account-section";

const host: Host = {
  id: "01HOST00000000000000000000",
  label: "Build machine",
  version: 3,
  connection: {
    type: "relay",
    serverId: "server-123",
    relayEndpoint: "wss://relay.example.test",
    useTls: true,
    daemonPublicKeyB64: "public-key",
  },
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

const confirmDelete = vi.fn();
const deleteHost = vi.fn();
const syncRuntime = vi.fn();
const reportFailure = vi.fn();

beforeEach(() => {
  confirmDelete.mockReset();
  deleteHost.mockReset();
  syncRuntime.mockReset();
  reportFailure.mockReset();
});

describe("deleteDashboardAccountHost", () => {
  it("does nothing when the user cancels confirmation", async () => {
    confirmDelete.mockResolvedValue(false);

    const result = await deleteDashboardAccountHost(host, {
      confirmDelete,
      deleteHost,
      syncRuntime,
      reportFailure,
    });

    expect(result).toBe("cancelled");
    expect(confirmDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "删除 Host？",
        confirmLabel: "删除",
        destructive: true,
      }),
    );
    expect(deleteHost).not.toHaveBeenCalled();
    expect(syncRuntime).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("syncs HostRuntime only after the account deletion succeeds", async () => {
    const operations: string[] = [];
    confirmDelete.mockResolvedValue(true);
    deleteHost.mockImplementation(async () => {
      operations.push("delete");
    });
    syncRuntime.mockImplementation(() => {
      operations.push("sync");
    });

    const result = await deleteDashboardAccountHost(host, {
      confirmDelete,
      deleteHost,
      syncRuntime,
      reportFailure,
    });

    expect(result).toBe("deleted");
    expect(deleteHost).toHaveBeenCalledWith(host.id);
    expect(operations).toEqual(["delete", "sync"]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports API failures and leaves HostRuntime unchanged", async () => {
    confirmDelete.mockResolvedValue(true);
    deleteHost.mockRejectedValue(new Error("Dashboard API unavailable"));

    const result = await deleteDashboardAccountHost(host, {
      confirmDelete,
      deleteHost,
      syncRuntime,
      reportFailure,
    });

    expect(result).toBe("failed");
    expect(syncRuntime).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith("Dashboard API unavailable");
  });
});
