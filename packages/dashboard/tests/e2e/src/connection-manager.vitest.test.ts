import { describe, it, expect } from "vitest";
import { createClientConfig } from "../../../web/src/paseo/connectionManager";
import type { Host } from "@getpaseo/dashboard-shared";

function makeHost(overrides: Partial<Host["connection"]> = {}): Host {
  return {
    id: "hst_test",
    label: "Test Host",
    version: 1,
    connection: {
      type: "relay",
      serverId: "srv_test",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "daemon-public-key",
      ...overrides,
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("Paseo connection manager config", () => {
  it("constructs wss URL with serverId, role=client, v=2 for hosted relay", () => {
    const config = createClientConfig(makeHost());

    expect(config.url).toContain("wss://relay.paseo.sh/ws");
    expect(config.url).toContain("serverId=srv_test");
    expect(config.url).toContain("role=client");
    expect(config.url).toContain("v=2");
  });

  it("enables E2EE with daemon public key", () => {
    const config = createClientConfig(makeHost());

    expect(config.e2ee).toEqual({
      enabled: true,
      daemonPublicKeyB64: "daemon-public-key",
    });
  });

  it("uses ws:// for non-TLS relay endpoint", () => {
    const config = createClientConfig(makeHost({ relayEndpoint: "127.0.0.1:8080", useTls: false }));

    expect(config.url).toContain("ws://127.0.0.1:8080/ws");
    expect(config.url).not.toContain("wss://");
  });

  it("sets browser clientType and unique clientId per host", () => {
    const config = createClientConfig(makeHost());

    expect(config.clientType).toBe("browser");
    expect(config.clientId).toContain("paseo-board-web-hst_test");
  });
});
