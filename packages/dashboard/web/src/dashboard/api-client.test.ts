import { describe, expect, it, vi } from "vitest";
import { DashboardApiClient, DashboardApiUnauthorizedError } from "./api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DashboardApiClient", () => {
  it("uses cookie credentials and the Dashboard auth and Host endpoints", async () => {
    const responses = [
      { user: { id: "usr_1", email: "user@example.com" } },
      { user: { id: "usr_1", email: "user@example.com" }, deviceId: "dev_1", expiresIn: 900 },
      { user: { id: "usr_1", email: "user@example.com" }, deviceId: "dev_1", expiresIn: 900 },
      [],
      {
        host: {
          id: "host_1",
          label: "Workstation",
          version: 1,
          connection: {
            type: "relay",
            serverId: "server_1",
            relayEndpoint: "relay.paseo.sh:443",
            useTls: true,
            daemonPublicKeyB64: "public-key",
          },
          createdAt: "2026-08-18T00:00:00.000Z",
          updatedAt: "2026-08-18T00:00:00.000Z",
        },
        syncRevision: 1,
      },
      {
        host: {
          id: "host_1",
          label: "Renamed Workstation",
          version: 2,
          connection: {
            type: "relay",
            serverId: "server_1",
            relayEndpoint: "relay.paseo.sh:443",
            useTls: true,
            daemonPublicKeyB64: "public-key",
          },
          createdAt: "2026-08-18T00:00:00.000Z",
          updatedAt: "2026-08-18T00:01:00.000Z",
        },
        syncRevision: 2,
      },
      { ok: true },
      { ok: true },
    ];
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return jsonResponse(responses.shift());
    };
    const client = new DashboardApiClient({ fetch: fetchImpl });
    const device = { installationId: "install_1", name: "Browser", platform: "web" as const };
    const connection = {
      type: "relay" as const,
      serverId: "server_1",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "public-key",
    };

    await client.getMe();
    await client.login({ email: "user@example.com", password: "password", device });
    await client.register({ email: "user@example.com", password: "password", device });
    await client.listHosts();
    await client.importHost({
      label: "Workstation",
      connection,
      clientVerification: {
        verifiedAt: "2026-08-18T00:00:00.000Z",
        serverVersion: "0.4.0",
      },
      idempotencyKey: "pair_1",
    });
    await client.updateHost("host_1", { label: "Renamed Workstation", baseVersion: 1 });
    await client.deleteHost("host_1");
    await client.logout();

    expect(fetchCalls.map(([url]) => url)).toEqual([
      "/api/v1/me",
      "/api/v1/auth/login",
      "/api/v1/auth/register",
      "/api/v1/hosts",
      "/api/v1/hosts/import",
      "/api/v1/hosts/host_1",
      "/api/v1/hosts/host_1",
      "/api/v1/auth/logout",
    ]);
    for (const [, init] of fetchCalls) {
      expect(init?.credentials).toBe("include");
    }
    expect(JSON.parse(String(fetchCalls[1]?.[1]?.body))).toMatchObject({
      email: "user@example.com",
      device: { installationId: "install_1", platform: "web" },
    });
    expect(fetchCalls[5]?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchCalls[5]?.[1]?.body))).toEqual({
      label: "Renamed Workstation",
      baseVersion: 1,
    });
    expect(fetchCalls[6]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("notifies the session layer when an authenticated request returns 401", async () => {
    const onUnauthorized = vi.fn();
    const client = new DashboardApiClient({
      fetch: async () =>
        jsonResponse({ error: { code: "unauthorized", message: "session expired" } }, 401),
      onUnauthorized,
    });

    await expect(client.listHosts()).rejects.toBeInstanceOf(DashboardApiUnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not notify for the startup session probe", async () => {
    const onUnauthorized = vi.fn();
    const client = new DashboardApiClient({
      fetch: async () =>
        jsonResponse({ error: { code: "unauthorized", message: "not signed in" } }, 401),
      onUnauthorized,
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(DashboardApiUnauthorizedError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
