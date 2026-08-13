import { describe, expect, it } from "vitest";
import { parseDiffDisplayLines } from "./diff-lines";

describe("parseDiffDisplayLines", () => {
  it("tracks old/new line numbers across hunks", () => {
    const rows = parseDiffDisplayLines(
      [
        "diff --git a/a.ts b/a.ts",
        "index 123..456 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -10,2 +10,3 @@",
        " context",
        "-old",
        "+new",
        "+added",
        "@@ -20,1 +21,1 @@",
        "-gone",
      ].join("\n"),
    );

    expect(rows).toEqual([
      { kind: "meta", text: "diff --git a/a.ts b/a.ts" },
      { kind: "meta", text: "index 123..456 100644" },
      { kind: "meta", text: "--- a/a.ts" },
      { kind: "meta", text: "+++ b/a.ts" },
      { kind: "hunk", text: "@@ -10,2 +10,3 @@" },
      { text: " context", lineNo: 10 },
      { kind: "remove", text: "-old", lineNo: 11 },
      { kind: "add", text: "+new", lineNo: 11 },
      { kind: "add", text: "+added", lineNo: 12 },
      { kind: "hunk", text: "@@ -20,1 +21,1 @@" },
      { kind: "remove", text: "-gone", lineNo: 20 },
    ]);
  });

  it("handles a bare hunk header by starting at line 1", () => {
    const rows = parseDiffDisplayLines(["@@ edit @@", "+x"].join("\n"));
    expect(rows[1]).toEqual({ kind: "add", text: "+x", lineNo: 1 });
  });

  it("marks unparseable lines as meta", () => {
    const rows = parseDiffDisplayLines(["@@ -1 +1 @@", "no-prefix-line"].join("\n"));
    expect(rows[1]).toEqual({ kind: "meta", text: "no-prefix-line" });
  });

  it("normalizes CRLF input", () => {
    const rows = parseDiffDisplayLines("@@ -1,1 +1,1 @@\r\n-a\r\n+b\r\n");
    // The trailing newline leaves one empty context row.
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "remove", "add", undefined]);
  });
});
