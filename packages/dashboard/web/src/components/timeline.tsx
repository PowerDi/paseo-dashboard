import type { AgentTimelineItem, ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { Check, ChevronUp, Circle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AgentTimelineState, TimelineEntry } from "@/stores/timeline-store";
import { cn } from "@/lib/utils";

function toolCallSummary(name: string, detail: ToolCallDetail): string {
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

function toolCallBody(detail: ToolCallDetail): string | null {
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

const toolStatusColor: Record<string, string> = {
  running: "var(--warning)",
  completed: "var(--foreground-faint)",
  failed: "var(--danger)",
  canceled: "var(--foreground-faint)",
};

function ToolCallRow({ item }: { item: Extract<AgentTimelineItem, { type: "tool_call" }> }) {
  const summary = toolCallSummary(item.name, item.detail);
  const body = toolCallBody(item.detail);
  const head = (
    <span className="inline-flex min-w-0 items-center gap-2 font-mono text-[13px] text-[var(--foreground-subtle)]">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          item.status === "running" && "status-dot-pulse",
        )}
        style={{ background: toolStatusColor[item.status] }}
      />
      <span className="truncate">{summary}</span>
    </span>
  );
  if (!body) {
    return <div className="flex items-center py-0.5">{head}</div>;
  }
  return (
    <details className="py-0.5">
      <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
        {head}
      </summary>
      <pre className="mt-1.5 max-h-64 overflow-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2.5 font-mono text-xs leading-relaxed text-[var(--foreground-muted)]">
        {body}
      </pre>
    </details>
  );
}

function TimelineItemView({ entry }: { entry: TimelineEntry }) {
  const { t } = useTranslation();
  const item = entry.item;

  switch (item.type) {
    case "user_message":
      return (
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
          {item.text}
        </div>
      );
    case "assistant_message":
      return (
        <div className="px-0.5 text-[14px] leading-relaxed text-[var(--foreground-muted)] whitespace-pre-wrap break-words">
          {item.text}
        </div>
      );
    case "reasoning":
      return (
        <details className="px-0.5">
          <summary className="cursor-pointer list-none text-[13px] text-[var(--foreground-faint)] [&::-webkit-details-marker]:hidden">
            {t("workspace.timeline.reasoning")}
          </summary>
          <div className="mt-1 text-[13px] leading-relaxed text-[var(--foreground-faint)] whitespace-pre-wrap break-words">
            {item.text}
          </div>
        </details>
      );
    case "tool_call":
      return <ToolCallRow item={item} />;
    case "todo":
      return (
        <div className="space-y-1 px-0.5 py-0.5">
          {item.items.map((task, index) => (
            <div
              key={task.id ?? index}
              className="flex items-start gap-2 text-[13px] text-[var(--foreground-subtle)]"
            >
              {task.completed || task.status === "completed" ? (
                <Check size={13} className="mt-0.5 shrink-0 text-[var(--success)]" />
              ) : (
                <Circle size={11} className="mt-1 shrink-0 text-[var(--foreground-faint)]" />
              )}
              <span className={cn(task.completed && "line-through opacity-60")}>{task.text}</span>
            </div>
          ))}
        </div>
      );
    case "error":
      return (
        <div className="px-0.5 text-[13px] text-[var(--danger)] whitespace-pre-wrap break-words">
          {item.message}
        </div>
      );
    case "compaction":
      return (
        <div className="px-0.5 text-[13px] text-[var(--foreground-faint)] italic">
          {t("workspace.timeline.compaction")}
        </div>
      );
    default:
      return null;
  }
}

export function TimelineView({
  timeline,
  onLoadOlder,
}: {
  timeline: AgentTimelineState | null;
  onLoadOlder: () => void;
}) {
  const { t } = useTranslation();

  if (!timeline || (timeline.loading && timeline.entries.length === 0)) {
    return (
      <div className="flex justify-center py-10">
        <LoaderCircle size={18} className="animate-spin text-[var(--foreground-faint)]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {timeline.hasOlder && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="ghost"
            className="text-[var(--foreground-faint)]"
            disabled={timeline.loadingOlder}
            onClick={onLoadOlder}
          >
            {timeline.loadingOlder ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <ChevronUp size={13} />
            )}
            {t("workspace.timeline.loadOlder")}
          </Button>
        </div>
      )}
      {timeline.error && (
        <p className="text-center text-[13px] text-[var(--danger)]">
          {t("workspace.timeline.loadFailed", { message: timeline.error })}
        </p>
      )}
      {timeline.entries.length === 0 && !timeline.error && (
        <p className="py-6 text-center text-[13px] text-[var(--foreground-faint)]">
          {t("workspace.timeline.empty")}
        </p>
      )}
      {timeline.entries.map((entry) => (
        <TimelineItemView key={`${entry.seqStart}-${entry.seqEnd}`} entry={entry} />
      ))}
    </div>
  );
}
