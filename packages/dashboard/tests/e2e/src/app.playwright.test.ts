import { expect, test, type Page } from "@playwright/test";
import type { Host } from "@getpaseo/dashboard-shared";

async function mockUnauthenticatedApi(page: Page) {
  const requestedPaths: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    requestedPaths.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "需要登录" } }),
    });
  });
  return requestedPaths;
}

async function mockAuthenticatedApi(page: Page, initialHosts: Host[] = []) {
  let hosts = [...initialHosts];
  const deletedHostIds: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/me") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "01DASHBOARDUSER", email: "user@example.com", role: "member" },
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/hosts") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(hosts) });
      return;
    }
    if (route.request().method() === "DELETE" && url.pathname.startsWith("/api/v1/hosts/")) {
      const hostId = decodeURIComponent(url.pathname.slice("/api/v1/hosts/".length));
      deletedHostIds.push(hostId);
      hosts = hosts.filter((host) => host.id !== hostId);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (url.pathname === "/api/v1/host-sync") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ fromRevision: 0, toRevision: 0, changes: [], hasMore: false }),
      });
      return;
    }
    if (url.pathname === "/api/v1/events") {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return deletedHostIds;
}

test.describe("Paseo Dashboard Web authentication boundary", () => {
  test("shows only account authentication before login", async ({ page }) => {
    const requestedPaths = await mockUnauthenticatedApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("dashboard-auth-screen")).toBeVisible();
    await expect(page.getByText("登录 Paseo Dashboard", { exact: true })).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-submit")).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-switch-mode")).toBeVisible();
    await expect(page.getByTestId("welcome-screen")).toHaveCount(0);
    await expect(page.getByTestId("pair-link-modal")).toHaveCount(0);
    expect(requestedPaths).not.toContain("/api/v1/hosts");
    expect(requestedPaths).not.toContain("/api/v1/host-sync");
  });

  test("exposes account Hosts and pairing only after authentication", async ({ page }) => {
    await mockAuthenticatedApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("welcome-screen")).toBeVisible();
    await expect(page.getByTestId("welcome-direct-connection")).toHaveCount(0);
    await expect(page.getByTestId("welcome-scan-qr")).toHaveCount(0);
    await page.getByTestId("welcome-paste-pairing-link").click();
    await expect(page.getByTestId("pair-link-modal")).toBeVisible();
    await expect(page.getByPlaceholder("https://app.paseo.sh/#offer=...")).toBeVisible();
  });

  test("manages paired Hosts from the account settings entry", async ({ page }) => {
    const host: Host = {
      id: "01DASHBOARDHOST",
      label: "Build machine",
      version: 1,
      connection: {
        type: "relay",
        serverId: "server-account-host",
        relayEndpoint: "relay.example.test:443",
        useTls: true,
        daemonPublicKeyB64: "public-key",
      },
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    };
    const deletedHostIds = await mockAuthenticatedApi(page, [host]);
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/settings/account", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("dashboard-account-section")).toBeVisible();
    await expect(page.getByTestId("dashboard-account-email")).toHaveText("user@example.com");
    await expect(page.getByTestId(`dashboard-account-host-${host.id}`)).toContainText(
      "Build machine",
    );
    await expect(page.getByTestId("dashboard-account-open-pairing")).toBeVisible();

    await page.getByTestId(`dashboard-account-delete-host-${host.id}`).click();

    await expect.poll(() => deletedHostIds).toEqual([host.id]);
    await expect(page.getByTestId(`dashboard-account-host-${host.id}`)).toHaveCount(0);
  });
});
