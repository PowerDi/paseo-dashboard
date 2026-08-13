import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeCodeLanguage } from "@/lib/code-language";
import { parseDiffDisplayLines } from "@/lib/diff-lines";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

function DiffContent({ code }: { code: string }) {
  const rows = useMemo(() => parseDiffDisplayLines(code), [code]);
  const lnDigits = useMemo(() => {
    let max = 1;
    for (const row of rows) {
      if (row.lineNo !== undefined) max = Math.max(max, row.lineNo);
    }
    return String(max).length;
  }, [rows]);

  return (
    <code className="content-diff-lines" style={{ ["--diff-ln-ch" as string]: String(lnDigits) }}>
      {rows.map((row, index) => (
        <span
          key={`${index}:${row.lineNo ?? ""}:${row.text}`}
          className="content-diff-line"
          data-diff={row.kind === "meta" ? undefined : row.kind}
        >
          <span className="content-diff-ln" aria-hidden="true">
            {row.lineNo !== undefined ? row.lineNo : ""}
          </span>
          <span className="content-diff-text">{row.text || " "}</span>
        </span>
      ))}
    </code>
  );
}

export function CodeBlock({ code, language }: { code: string; language?: string | undefined }) {
  const { t } = useTranslation();
  const normalized = normalizeCodeLanguage(language);
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => {
    if (normalized === "diff" || !hljs.getLanguage(normalized)) return "";
    return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
  }, [normalized, code]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  const copyLabel = t(copied ? "workspace.timeline.codeCopied" : "workspace.timeline.codeCopy");

  return (
    <div className="content-code-block" data-language={normalized}>
      <div className="content-code-header">
        <span className="content-code-language font-mono text-[11px] font-normal">
          {normalized === "plaintext" ? "text" : normalized}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void copyCode()}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className={cn("content-code-pre", normalized === "diff" && "content-code-diff")}>
        {normalized === "diff" ? (
          <DiffContent code={code} />
        ) : highlighted ? (
          <code
            className={`hljs language-${normalized}`}
            // hljs output is escaped markup it generated itself, not user HTML.
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}
