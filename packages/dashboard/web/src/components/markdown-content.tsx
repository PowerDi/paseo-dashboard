import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

/**
 * Streaming-safe markdown renderer for agent timeline messages.
 * Code fences go through CodeBlock (highlight.js + copy button); links open
 * in a new tab (the dashboard has no file-open bridge like the desktop app).
 */
export const MarkdownContent = memo(function MarkdownContent({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  if (!children) return null;
  return (
    <div className={cn("dash-md", className)} data-testid="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a({ href, children: linkChildren }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            );
          },
          code({ className: codeClassName, children: codeChildren }) {
            const match = /(?:^|\s)language-([^\s]+)/.exec(codeClassName ?? "");
            const code = (Array.isArray(codeChildren) ? codeChildren : [codeChildren])
              .map((child) =>
                typeof child === "string" || typeof child === "number" ? `${child}` : "",
              )
              .join("")
              .replace(/\n$/, "");
            if (match || code.includes("\n")) {
              return <CodeBlock code={code} language={match?.[1]} />;
            }
            return <code className={codeClassName}>{codeChildren}</code>;
          },
          pre({ children: preChildren }) {
            return <>{preChildren}</>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
