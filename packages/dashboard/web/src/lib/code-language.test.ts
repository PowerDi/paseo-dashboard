import { describe, expect, it } from "vitest";
import { normalizeCodeLanguage } from "./code-language";

describe("normalizeCodeLanguage", () => {
  it("falls back to plaintext", () => {
    expect(normalizeCodeLanguage(undefined)).toBe("plaintext");
    expect(normalizeCodeLanguage("")).toBe("plaintext");
    expect(normalizeCodeLanguage("   ")).toBe("plaintext");
  });

  it("resolves aliases case-insensitively", () => {
    expect(normalizeCodeLanguage("TS")).toBe("typescript");
    expect(normalizeCodeLanguage("sh")).toBe("bash");
    expect(normalizeCodeLanguage("py")).toBe("python");
    expect(normalizeCodeLanguage("md")).toBe("markdown");
  });

  it("passes through unknown languages", () => {
    expect(normalizeCodeLanguage("rust")).toBe("rust");
  });
});
