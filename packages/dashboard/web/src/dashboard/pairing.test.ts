import type { Host, User } from "@getpaseo/dashboard-shared";
import { describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "./api-client";
import { buildDashboardHostImport, pairDashboardHost, parseDashboardPairingLink } from "./pairing";
import { createDashboardSessionStore } from "./session-store";

function pairingUrl(offer: object): string {
  return `https://app.paseo.sh/#offer=${Buffer.from(JSON.stringify(offer), "utf8").toString("base64url")}`;
}

const USER: User = { id: "usr_1", email: "user@example.com" };
const URL = pairingUrl({
  v: 2,
  serverId: "server_1",
  daemonPublicKeyB64: "public-key",
  relay: { endpoint: "relay.paseo.sh:443" },
});

describe("Dashboard pairing", () => {
  it("normalizes a relay pairing link into the account Host contract", () => {
    const normalizedOffer = parseDashboardPairingLink(URL);
    const request = buildDashboardHostImport({
      normalizedOffer,
      label: " Workstation ",
      idempotencyKey: "pair_1",
      verification: {
        verifiedAt: "2026-08-18T00:00:00.000Z",
        serverVersion: "0.4.0",
      },
    });

    expect(request).toEqual({
      label: "Workstation",
      connection: {
        type: "relay",
        serverId: "server_1",
        relayEndpoint: "relay.paseo.sh:443",
        useTls: true,
        daemonPublicKeyB64: "public-key",
      },
      clientVerification: {
        verifiedAt: "2026-08-18T00:00:00.000Z",
        serverVersion: "0.4.0",
      },
      idempotencyKey: "pair_1",
    });
  });

  it("verifies before importing and returns the persisted Host", async () => {
    const persistedHost: Host = {
      id: "host_1",
      label: "Workstation",
      version: 1,
      connection: parseDashboardPairingLink(URL).connection,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    };
    const calls: string[] = [];
    const api: DashboardApi = {
      getMe: vi.fn(async () => ({ user: USER })),
      login: vi.fn(async () => {
        calls.push("login");
        return { user: USER, deviceId: "dev_1", expiresIn: 900 };
      }),
      register: vi.fn(async () => ({ user: USER, deviceId: "dev_1", expiresIn: 900 })),
      logout: vi.fn(async () => ({ ok: true })),
      listHosts: vi.fn(async () => {
        calls.push("hosts");
        return [];
      }),
      importHost: vi.fn(async () => {
        calls.push("import");
        return { host: persistedHost, syncRevision: 1 };
      }),
      updateHost: vi.fn(async () => ({ host: persistedHost, syncRevision: 1 })),
      deleteHost: vi.fn(async () => ({ ok: true })),
      setUnauthorizedHandler: vi.fn(),
    };
    const store = createDashboardSessionStore({
      api,
      getDeviceInfo: () => ({ installationId: "install_1", name: "Browser", platform: "web" }),
    });
    await store.login("user@example.com", "password");

    const host = await pairDashboardHost({
      session: store,
      pairing: { pairingLink: URL, label: "Workstation", idempotencyKey: "pair_1" },
      verify: async () => {
        calls.push("verify");
        return { verifiedAt: "2026-08-18T00:00:00.000Z", serverVersion: "0.4.0" };
      },
    });

    expect(host).toEqual(persistedHost);
    expect(calls).toEqual(["login", "hosts", "verify", "import"]);
  });
});
