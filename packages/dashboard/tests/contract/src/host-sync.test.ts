import { describe, it, expect } from "vitest";
import type { Host, SyncChange, SyncResponse } from "@getpaseo/dashboard-shared";

describe("Host sync contract", () => {
  it("should define a valid upsert change", () => {
    const host: Host = {
      id: "hst_01JABCDEFGHIJKLMNOPQRSTUV",
      label: "Home Server",
      version: 1,
      connection: {
        type: "relay",
        serverId: "srv_01JABCDEFGHIJKLMNOPQRSTUV",
        relayEndpoint: "relay.paseo.sh:443",
        useTls: true,
        daemonPublicKeyB64: "dGVzdC1kYWVtb24tcHVibGljLWtleQ==",
      },
      createdAt: "2026-08-11T10:00:00Z",
      updatedAt: "2026-08-11T10:00:00Z",
    };

    const change: SyncChange = {
      revision: 13,
      operation: "upsert",
      host,
    };

    expect(change.operation).toBe("upsert");
    expect(change.host.label).toBe("Home Server");
  });

  it("should define a valid delete change", () => {
    const change: SyncChange = {
      revision: 15,
      operation: "delete",
      hostId: "hst_old",
      deletedAt: "2026-08-11T10:20:00Z",
    };

    expect(change.operation).toBe("delete");
    if (change.operation === "delete") {
      expect(change.hostId).toBe("hst_old");
    }
  });

  it("should carry revision metadata", () => {
    const response: SyncResponse = {
      fromRevision: 12,
      toRevision: 15,
      changes: [],
      hasMore: false,
    };

    expect(response.toRevision).toBeGreaterThan(response.fromRevision);
  });
});
