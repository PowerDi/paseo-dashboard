import { describe, expect, it } from "vitest";
import { agentPath, pagePaths, parseDashboardRoute } from "./routes";

describe("parseDashboardRoute", () => {
  it("maps every page path to its page", () => {
    for (const [page, path] of Object.entries(pagePaths)) {
      expect(parseDashboardRoute(path)).toEqual({ page, selection: null });
    }
  });

  it("returns null for unknown paths so the caller can canonicalize", () => {
    expect(parseDashboardRoute("/")).toBeNull();
    expect(parseDashboardRoute("/nope")).toBeNull();
    expect(parseDashboardRoute("/agent/only-host")).toBeNull();
    expect(parseDashboardRoute("/agent/host/agent/extra")).toBeNull();
  });

  it("reads host and agent from an agent deep link", () => {
    expect(parseDashboardRoute("/agent/01HOST/01AGENT")).toEqual({
      page: "workspace",
      selection: { hostId: "01HOST", agentId: "01AGENT" },
    });
  });

  it("round-trips ids that need encoding", () => {
    const path = agentPath("host/one", "agent one");
    expect(path).toBe("/agent/host%2Fone/agent%20one");
    expect(parseDashboardRoute(path)).toEqual({
      page: "workspace",
      selection: { hostId: "host/one", agentId: "agent one" },
    });
  });

  it("returns null for a malformed percent escape instead of throwing", () => {
    expect(parseDashboardRoute("/agent/%E0%A4%A/01AGENT")).toBeNull();
  });
});
