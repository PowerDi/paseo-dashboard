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

it("fetches the current user from /me", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ user: { id: "usr1", email: "a@b.com" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const client = new DashboardApiClient({ fetch: fetchMock });

  await expect(client.getMe()).resolves.toEqual({
    user: { id: "usr1", email: "a@b.com" },
  });
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/me");
});

it("supports passkey ceremony endpoints", async () => {
  const responses = [
    { ceremonyId: "ceremony-login", options: { challenge: "login-challenge" } },
    { user: { id: "usr1", email: "a@b.com" }, deviceId: "dev1", expiresIn: 900 },
    { ceremonyId: "ceremony-registration", options: { challenge: "registration-challenge" } },
    {
      passkey: {
        id: "psk1",
        name: "Laptop",
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: "2026-08-16T00:00:00.000Z",
        lastUsedAt: null,
      },
    },
  ];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const client = new DashboardApiClient({ fetch: fetchMock });

  await expect(client.beginPasskeyLogin()).resolves.toMatchObject({ ceremonyId: "ceremony-login" });
  await client.finishPasskeyLogin(
    "ceremony-login",
    {
      id: "credential",
      rawId: "credential",
      response: {},
      clientExtensionResults: {},
      type: "public-key",
    } as never,
    { installationId: "install", name: "Browser", platform: "web" },
  );
  await expect(client.beginPasskeyRegistration("current-password")).resolves.toMatchObject({
    ceremonyId: "ceremony-registration",
  });
  await client.finishPasskeyRegistration(
    "ceremony-registration",
    {
      id: "credential",
      rawId: "credential",
      response: {},
      clientExtensionResults: {},
      type: "public-key",
    } as never,
    "Laptop",
  );

  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toMatchObject({
    ceremonyId: "ceremony-login",
    device: { installationId: "install" },
  });
  expect(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body))).toEqual({
    currentPassword: "current-password",
  });
});
