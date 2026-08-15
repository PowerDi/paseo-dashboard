import { describe, it, expect } from "vitest";
import { getDaemonFeatures, isCompatibleDaemon } from "../../../web/src/paseo/features";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

/**
 * P3.5 Compatibility Tests - daemon version matrix
 *
 * Tests Dashboard client behavior against different daemon versions.
 * Validates that feature gating works correctly and Dashboard gracefully
 * handles old daemons that don't advertise features.
 *
 * Version matrix (based on Paseo feature rollout):
 * - v0.1.80 and earlier: no features field
 * - v0.1.81+: terminal-restore-modes feature
 * - v0.1.106+: selectiveAgentTimeline feature
 */

describe("Daemon version compatibility", () => {
  describe("getDaemonFeatures", () => {
    it("returns all false for old daemon without features field", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.80",
        hostname: "test-host",
        // Old daemon: no features field at all
      };

      const features = getDaemonFeatures(serverInfo);

      expect(features.selectiveAgentTimeline).toBe(false);
      expect(features.terminalRestoreModes).toBe(false);
    });

    it("returns all false for null server_info", () => {
      const features = getDaemonFeatures(null);

      expect(features.selectiveAgentTimeline).toBe(false);
      expect(features.terminalRestoreModes).toBe(false);
    });

    it("returns all false for empty features object", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.80",
        hostname: "test-host",
        features: {},
      };

      const features = getDaemonFeatures(serverInfo);

      expect(features.selectiveAgentTimeline).toBe(false);
      expect(features.terminalRestoreModes).toBe(false);
    });

    it("detects terminal-restore-modes for v0.1.81+ daemon", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.81",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
        },
      };

      const features = getDaemonFeatures(serverInfo);

      expect(features.terminalRestoreModes).toBe(true);
      expect(features.selectiveAgentTimeline).toBe(false);
    });

    it("detects selectiveAgentTimeline for v0.1.106+ daemon", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.106",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
          selectiveAgentTimeline: true,
        },
      };

      const features = getDaemonFeatures(serverInfo);

      expect(features.terminalRestoreModes).toBe(true);
      expect(features.selectiveAgentTimeline).toBe(true);
    });

    it("handles explicitly false feature flags", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.106",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": false,
          selectiveAgentTimeline: false,
        },
      };

      const features = getDaemonFeatures(serverInfo);

      expect(features.terminalRestoreModes).toBe(false);
      expect(features.selectiveAgentTimeline).toBe(false);
    });

    it("ignores unknown feature flags", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.2.0",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
          selectiveAgentTimeline: true,
          unknownFeature: true,
        } as Record<string, boolean>,
      };

      const features = getDaemonFeatures(serverInfo);

      // Should not throw, should only extract known features. Assert the unknown
      // key is dropped rather than a key count, so adding a feature to
      // DaemonFeatures doesn't break this test.
      expect(features.terminalRestoreModes).toBe(true);
      expect(features.selectiveAgentTimeline).toBe(true);
      expect(features).not.toHaveProperty("unknownFeature");
    });
  });

  describe("isCompatibleDaemon", () => {
    it("accepts old daemon without features (graceful degradation)", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.80",
        hostname: "test-host",
      };

      expect(isCompatibleDaemon(serverInfo)).toBe(true);
    });

    it("accepts daemon with partial features", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.81",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
        },
      };

      expect(isCompatibleDaemon(serverInfo)).toBe(true);
    });

    it("accepts daemon with all features", () => {
      const serverInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.106",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
          selectiveAgentTimeline: true,
        },
      };

      expect(isCompatibleDaemon(serverInfo)).toBe(true);
    });

    it("accepts null server_info (handles race during connection)", () => {
      expect(isCompatibleDaemon(null)).toBe(true);
    });
  });
});

describe("Feature gating behavior", () => {
  describe("selectiveAgentTimeline gating", () => {
    it("gates viewAgent/leaveAgent when feature is missing", () => {
      const oldDaemonInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.80",
        hostname: "test-host",
      };

      const features = getDaemonFeatures(oldDaemonInfo);

      // When selectiveAgentTimeline is false, dashboardRuntime should NOT
      // call client.setAgentTimelineSubscription. This is verified in
      // dashboardRuntime.test.ts with the actual gating logic.
      expect(features.selectiveAgentTimeline).toBe(false);
    });

    it("enables viewAgent/leaveAgent when feature is present", () => {
      const newDaemonInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.106",
        hostname: "test-host",
        features: {
          selectiveAgentTimeline: true,
        },
      };

      const features = getDaemonFeatures(newDaemonInfo);

      expect(features.selectiveAgentTimeline).toBe(true);
    });
  });

  describe("terminalRestoreModes gating", () => {
    it("gates terminal restore options when feature is missing", () => {
      const oldDaemonInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.80",
        hostname: "test-host",
      };

      const features = getDaemonFeatures(oldDaemonInfo);

      // When terminalRestoreModes is false, terminalSession should NOT
      // pass restore options to onTerminalStreamEvent. This is verified in
      // terminalSession.test.ts with the actual gating logic.
      expect(features.terminalRestoreModes).toBe(false);
    });

    it("enables terminal restore options when feature is present", () => {
      const newDaemonInfo: ServerInfoStatusPayload = {
        status: "server_info",
        serverId: "test-server",
        version: "0.1.81",
        hostname: "test-host",
        features: {
          "terminal-restore-modes": true,
        },
      };

      const features = getDaemonFeatures(newDaemonInfo);

      expect(features.terminalRestoreModes).toBe(true);
    });
  });
});
