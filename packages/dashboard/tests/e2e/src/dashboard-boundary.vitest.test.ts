import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, "../../../web");
const repositoryRoot = path.resolve(webRoot, "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(webRoot, relativePath), "utf8");
}

describe("Dashboard Expo project boundary", () => {
  it("owns an Expo/Metro entry and does not depend on Paseo App or Vite", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const allDependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    expect(manifest.scripts?.dev).toContain("expo start --web --port 8082");
    expect(allDependencies.expo).toBeDefined();
    expect(allDependencies.vite).toBeUndefined();
    expect(allDependencies["@getpaseo/app"]).toBeUndefined();
    expect(read("metro.config.cjs")).toContain('req.url?.startsWith("/api/")');
  });

  it("tracks the Paseo release version through its own package", () => {
    const rootManifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      version: string;
    };
    const appManifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "packages/app/package.json"), "utf8"),
    ) as { version: string };
    const dashboardManifest = JSON.parse(read("package.json")) as { version: string };
    const appConfig = read("app.config.js");

    expect(dashboardManifest.version).toBe(rootManifest.version);
    expect(dashboardManifest.version).toBe(appManifest.version);
    expect(appConfig).toContain('require("./package.json")');
    expect(appConfig).toContain("version: pkg.version");
    expect(appConfig).not.toContain("packages/app");
  });

  it("keeps login outside the App runtime and exposes pairing without direct Host UI", () => {
    const layout = read("src/app/_layout.tsx");
    const settings = read("src/screens/settings-screen.tsx");
    const welcome = read("src/components/welcome-screen.tsx");

    expect(layout).toContain("<DashboardSessionProvider>");
    expect(layout).toContain("<DashboardLoginGate>");
    expect(layout).toContain("<DashboardAccountHostRuntimeBridge />");
    expect(welcome).toContain('testID: "welcome-paste-pairing-link"');
    expect(welcome).not.toContain("welcome-direct-connection");
    expect(welcome).not.toContain("welcome-scan-qr");
    expect(welcome).not.toContain("AddHostModal");
    expect(settings).toContain('id: "account"');
    expect(settings).toContain("<DashboardAccountSection onPairHost={handleAddHost} />");
  });
});
