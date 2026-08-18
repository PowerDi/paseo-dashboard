import { describe, expect, it } from "vitest";
import type { Host as DashboardHost } from "@getpaseo/dashboard-shared";
import { dashboardHostToProfile } from "./dashboard-host-profile";

const HOST: DashboardHost = {
  id: "hst_1",
  label: "Workstation",
  version: 2,
  connection: {
    type: "relay",
    serverId: "srv_1",
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: "public-key",
  },
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T01:00:00.000Z",
};

describe("dashboardHostToProfile", () => {
  it("maps an account Host to the Relay-only App runtime profile", () => {
    expect(dashboardHostToProfile(HOST)).toMatchObject({
      serverId: "srv_1",
      label: "Workstation",
      connections: [
        {
          id: "relay:srv_1",
          type: "relay",
          relayEndpoint: "relay.paseo.sh:443",
          useTls: true,
          daemonPublicKeyB64: "public-key",
        },
      ],
      preferredConnectionId: "relay:srv_1",
      createdAt: HOST.createdAt,
      updatedAt: HOST.updatedAt,
    });
  });

  it("preserves copied App appearance for an existing account Host", () => {
    const existing = dashboardHostToProfile(HOST);
    existing.appearance = { color: "violet", badgeDisplay: "name" };

    expect(dashboardHostToProfile({ ...HOST, label: "Renamed" }, existing)).toMatchObject({
      label: "Renamed",
      appearance: existing.appearance,
    });
  });
});
