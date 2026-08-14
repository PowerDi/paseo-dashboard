import { describe, test, expect } from "vitest";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { getDaemonFeatures, isCompatibleDaemon } from "./features";

describe("getDaemonFeatures", () => {
  test("returns all false when serverInfo is null", () => {
    const features = getDaemonFeatures(null);
    expect(features.selectiveAgentTimeline).toBe(false);
    expect(features.terminalRestoreModes).toBe(false);
  });

  test("returns all false when features object is missing", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(false);
    expect(features.terminalRestoreModes).toBe(false);
  });

  test("returns false for features not advertised by daemon", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
      features: {},
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(false);
    expect(features.terminalRestoreModes).toBe(false);
  });

  test("returns true for selectiveAgentTimeline when advertised", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
      features: { selectiveAgentTimeline: true },
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(true);
    expect(features.terminalRestoreModes).toBe(false);
  });

  test("returns true for terminalRestoreModes when advertised", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
      features: { "terminal-restore-modes": true },
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(false);
    expect(features.terminalRestoreModes).toBe(true);
  });

  test("returns true for multiple features when all advertised", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
      features: {
        selectiveAgentTimeline: true,
        "terminal-restore-modes": true,
      },
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(true);
    expect(features.terminalRestoreModes).toBe(true);
  });

  test("ignores unrelated features from protocol", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "test-server",
      hostname: null,
      version: null,
      features: {
        selectiveAgentTimeline: true,
        daemonDiagnostics: true,
      },
    };
    const features = getDaemonFeatures(serverInfo);
    expect(features.selectiveAgentTimeline).toBe(true);
    expect(features.terminalRestoreModes).toBe(false);
  });
});

describe("isCompatibleDaemon", () => {
  test("returns true for null serverInfo (graceful degradation)", () => {
    expect(isCompatibleDaemon(null)).toBe(true);
  });

  test("returns true for daemon without any features (graceful degradation)", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "old-daemon",
      hostname: null,
      version: null,
      features: {},
    };
    expect(isCompatibleDaemon(serverInfo)).toBe(true);
  });

  test("returns true for daemon with all features", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "new-daemon",
      hostname: null,
      version: null,
      features: {
        selectiveAgentTimeline: true,
        "terminal-restore-modes": true,
      },
    };
    expect(isCompatibleDaemon(serverInfo)).toBe(true);
  });
});
