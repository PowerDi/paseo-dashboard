import { describe, expect, it } from "vitest";
import { formatElapsed } from "./format-time";

describe("formatElapsed", () => {
  it("uses bare seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(8_400)).toBe("8s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("switches to m:ss at a minute", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(64_000)).toBe("1:04");
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("adds an hour segment past an hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("clamps negative clock skew to zero", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});
