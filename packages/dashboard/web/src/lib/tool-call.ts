import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

/** One-line label for a tool call, used by both the timeline row and the live status. */
export function toolCallSummary(name: string, detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return `${detail.type} ${detail.filePath}`;
    case "search":
      return `${detail.toolName ?? "search"} ${detail.query}`;
    case "fetch":
      return detail.url;
    case "worktree_setup":
      return detail.branchName;
    case "sub_agent":
      return detail.description ?? name;
    case "plain_text":
      return detail.label ?? name;
    case "plan":
      return name;
    default:
      return name;
  }
}

/** Expandable body for a tool call, or null when the call has nothing to show. */
export function toolCallBody(detail: ToolCallDetail): string | null {
  switch (detail.type) {
    case "shell":
      return detail.output ?? null;
    case "edit":
      return detail.unifiedDiff ?? null;
    case "plan":
      return detail.text;
    default:
      return null;
  }
}
