/** Map common fence tags to the highlight.js language ids registered in code-block.tsx. */
const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  console: "bash",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  shell: "bash",
  sh: "bash",
  text: "plaintext",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

export function normalizeCodeLanguage(language: string | undefined): string {
  const value = language?.trim().toLowerCase() || "plaintext";
  return LANGUAGE_ALIASES[value] ?? value;
}
