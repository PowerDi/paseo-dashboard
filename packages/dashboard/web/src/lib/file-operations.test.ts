import { describe, expect, test } from "vitest";
import {
  decodeTextFile,
  fileNameFromPath,
  MAX_TEXT_FILE_BYTES,
  parentDirectoryPath,
} from "./file-operations";

describe("file operations", () => {
  test("derives parent directories and file names from daemon paths", () => {
    expect(parentDirectoryPath("src/components/message.tsx")).toBe("src/components");
    expect(parentDirectoryPath("README.md")).toBe("");
    expect(fileNameFromPath("src/components/message.tsx")).toBe("message.tsx");
  });

  test("decodes UTF-8 text uploads", () => {
    expect(decodeTextFile(new TextEncoder().encode("你好\nexport {};"))).toEqual({
      status: "ready",
      content: "你好\nexport {};",
    });
  });

  test("rejects binary and oversized uploads", () => {
    expect(decodeTextFile(new Uint8Array([0, 1, 2, 3]))).toEqual({ status: "binary" });
    expect(decodeTextFile(new Uint8Array([1, 2, 3, 4]))).toEqual({ status: "binary" });
    expect(decodeTextFile(new Uint8Array([127, 127, 65]))).toEqual({ status: "binary" });
    expect(decodeTextFile(new Uint8Array(MAX_TEXT_FILE_BYTES + 1))).toEqual({
      status: "too-large",
    });
  });
});
