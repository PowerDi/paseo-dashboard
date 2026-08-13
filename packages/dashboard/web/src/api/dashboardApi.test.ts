import { describe, expect, it, vi } from "vitest";
import { DashboardApiClient, DashboardApiUnauthorizedError } from "./dashboardApi";

describe("DashboardApiClient", () => {
  it("adds bearer auth to requests and notifies on 401", async () => {
    const onUnauthorized = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: "unauthorized", message: "expired" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = new DashboardApiClient({
      accessToken: "token-123",
      fetch: fetchMock,
      onUnauthorized,
    });

    await expect(client.listHosts()).rejects.toBeInstanceOf(DashboardApiUnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(
      ((fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers).get("Authorization"),
    ).toBe("Bearer token-123");
  });
});
