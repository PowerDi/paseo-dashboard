import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { Check, Circle, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/code-block";
import { MarkdownContent } from "@/components/markdown-content";
import { TimelineLiveStatus } from "@/components/timeline-live-status";
import type { LiveActivity } from "@/lib/live-activity";
import { toolCallBody, toolCallSummary } from "@/lib/tool-call";
import type { AgentTimelineState, TimelineEntry } from "@/stores/timeline-store";
import { cn } from "@/lib/utils";

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
      <div className="mt-1.5">
        <CodeBlock code={body} language={item.detail.type === "edit" ? "diff" : undefined} />
      </div>
    </details>
  );
}

function TimelineItemView({ entry }: { entry: TimelineEntry }) {
  const { t } = useTranslation();
  const item = entry.item;

  switch (item.type) {
    case "user_message":
      return (
        <div className="flex justify-end">
          <div className="thread-user-bubble">{item.text}</div>
        </div>
      );
    case "assistant_message":
      return <MarkdownContent>{item.text}</MarkdownContent>;
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

function LoadOlderSentinel({
  loading,
  onLoadOlder,
}: {
  loading: boolean;
  onLoadOlder: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !loading) {
            onLoadOlder();
          }
        }
      },
      // Trigger when the sentinel is within 200px of the viewport so the
      // next page is fetched before the user reaches the absolute top.
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, onLoadOlder]);

  return (
    <div ref={sentinelRef} className="flex justify-center py-2">
      {loading && (
        <LoaderCircle size={14} className="animate-spin text-[var(--foreground-faint)]" />
      )}
    </div>
  );
}

export function TimelineView({
  timeline,
  liveActivity,
  onLoadOlder,
}: {
  timeline: AgentTimelineState | null;
  liveActivity: LiveActivity | null;
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
        <LoadOlderSentinel loading={timeline.loadingOlder} onLoadOlder={onLoadOlder} />
      )}
      {timeline.error && (
        <p className="text-center text-[13px] text-[var(--danger)]">
          {t("workspace.timeline.loadFailed", { message: timeline.error })}
        </p>
      )}
      {timeline.entries.length === 0 && !timeline.error && !liveActivity && (
        <p className="py-6 text-center text-[13px] text-[var(--foreground-faint)]">
          {t("workspace.timeline.empty")}
        </p>
      )}
      {timeline.entries.map((entry) => (
        // content-visibility skips layout/paint for offscreen entries so long
        // timelines stay cheap without a virtual-list dependency (the store
        // caps entry count; this caps render cost). The intrinsic size keeps
        // the scrollbar stable while items are unrendered.
        <div
          key={`${entry.seqStart}-${entry.seqEnd}`}
          className={cn(
            "[contain-intrinsic-size:auto_64px] [content-visibility:auto]",
            entry.item.type === "user_message" && "pt-3",
          )}
        >
          <TimelineItemView entry={entry} />
        </div>
      ))}
      {liveActivity && <TimelineLiveStatus activity={liveActivity} />}
    </div>
  );
}
