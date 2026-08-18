import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@getpaseo/dashboard-server/config";

describe("Dashboard server config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults browser access and WebAuthn to the Dashboard Web development origin", () => {
    vi.stubEnv("PASEO_BOARD_CORS_ORIGIN", "");
    vi.stubEnv("PASEO_BOARD_WEBAUTHN_ORIGIN", "");
    vi.stubEnv("PASEO_BOARD_WEBAUTHN_RP_ID", "");

    const config = loadConfig();

    expect(config.corsOrigin).toBe("http://localhost:8082");
    expect(config.webauthnOrigin).toBe("http://localhost:8082");
    expect(config.webauthnRpId).toBe("localhost");
  });

  it("uses the first configured CORS origin as the WebAuthn default", () => {
    vi.stubEnv("PASEO_BOARD_CORS_ORIGIN", "https://app.example.com, https://desktop.example.com");
    vi.stubEnv("PASEO_BOARD_WEBAUTHN_ORIGIN", "");
    vi.stubEnv("PASEO_BOARD_WEBAUTHN_RP_ID", "");

    const config = loadConfig();

    expect(config.corsOrigin).toBe("https://app.example.com, https://desktop.example.com");
    expect(config.webauthnOrigin).toBe("https://app.example.com");
    expect(config.webauthnRpId).toBe("app.example.com");
  });
});
