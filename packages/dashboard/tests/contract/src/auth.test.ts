import { describe, it, expect } from "vitest";
import type { LoginRequest, LoginResponse, DeviceInfo } from "@getpaseo/dashboard-shared";

describe("Auth contract", () => {
  it("should define a valid login request", () => {
    const device: DeviceInfo = {
      installationId: "dev_01JABCDEFGHIJKLMNOPQRSTUV",
      name: "Chrome on Linux",
      platform: "web",
    };

    const req: LoginRequest = {
      email: "user@example.com",
      password: "secure-password",
      device,
    };

    expect(req.email).toBe("user@example.com");
    expect(req.device.platform).toBe("web");
  });

  it("should define a valid login response", () => {
    const res: LoginResponse = {
      user: { id: "usr_01JABCDEFGHIJKLMNOPQRSTUV", email: "user@example.com" },
      deviceId: "dev_01JABCDEFGHIJKLMNOPQRSTUV",
      expiresIn: 900,
    };

    expect(res.user.email).toBe("user@example.com");
    expect(res.expiresIn).toBe(900);
  });
});
