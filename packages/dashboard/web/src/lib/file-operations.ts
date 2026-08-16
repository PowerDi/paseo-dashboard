export const MAX_TEXT_FILE_BYTES = 1024 * 1024;

export type TextFileDecodeResult =
  | { status: "ready"; content: string }
  | { status: "binary" }
  | { status: "too-large" };

export function parentDirectoryPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

export function fileNameFromPath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function decodeTextFile(bytes: Uint8Array): TextFileDecodeResult {
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) return { status: "too-large" };

  let suspiciousBytes = 0;
  for (const byte of bytes) {
    if (byte === 0) return { status: "binary" };
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl || byte === 127) suspiciousBytes += 1;
  }
  if (bytes.byteLength > 0 && suspiciousBytes / bytes.byteLength > 0.3) {
    return { status: "binary" };
  }

  try {
    return { status: "ready", content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: "binary" };
  }
}
