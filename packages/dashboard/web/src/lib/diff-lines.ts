/**
 * Parse unified-diff text into display rows with per-side line numbers.
 * Ported from zeno's process-activity.ts (same output shape).
 */
export type DiffDisplayLine = {
  /** add / remove / hunk / meta (file headers); undefined = context. */
  kind?: "add" | "remove" | "hunk" | "meta";
  /** 1-based file line number when known (omitted for headers / ellipsis). */
  lineNo?: number;
  /** Visible text including leading +/-/space marker. */
  text: string;
};

export function parseDiffDisplayLines(code: string): DiffDisplayLine[] {
  const rawLines = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: DiffDisplayLine[] = [];
  let oldLn = 0;
  let newLn = 0;
  let tracking = false;

  for (const line of rawLines) {
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      rows.push({ kind: "meta", text: line || " " });
      continue;
    }

    if (line.startsWith("@@")) {
      const unified = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/.exec(line);
      if (unified) {
        oldLn = Number(unified[1]);
        newLn = Number(unified[2]);
        tracking = true;
      } else {
        oldLn = 1;
        newLn = 1;
        tracking = true;
      }
      rows.push({ kind: "hunk", text: line || " " });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const lineNo = tracking ? newLn : undefined;
      if (tracking) newLn += 1;
      rows.push({
        kind: "add",
        ...(lineNo !== undefined ? { lineNo } : {}),
        text: line.length ? line : "+",
      });
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const lineNo = tracking ? oldLn : undefined;
      if (tracking) oldLn += 1;
      rows.push({
        kind: "remove",
        ...(lineNo !== undefined ? { lineNo } : {}),
        text: line.length ? line : "-",
      });
      continue;
    }
    if (line.startsWith(" ") || line === "") {
      const lineNo = tracking ? newLn : undefined;
      if (tracking) {
        oldLn += 1;
        newLn += 1;
      }
      rows.push({
        ...(lineNo !== undefined ? { lineNo } : {}),
        text: line.length ? line : " ",
      });
      continue;
    }

    rows.push({ kind: "meta", text: line || " " });
  }

  return rows;
}
