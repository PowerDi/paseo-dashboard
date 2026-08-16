import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { Check, LoaderCircle, ShieldQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/code-block";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toolCallSummary } from "@/lib/tool-call";
import { cn } from "@/lib/utils";
import {
  arePermissionQuestionsAnswered,
  buildPermissionActionResponse,
  buildPermissionQuestionResponse,
  buildRememberedPermissionResponse,
  getPermissionPlanText,
  parsePermissionQuestions,
  questionShowsFreeform,
  shouldSubmitEmptyPermissionQuestions,
  type PermissionQuestion,
  type PermissionQuestionFreeform,
} from "./permission-request-form";

interface PermissionRequestsProps {
  requests: readonly AgentPermissionRequest[];
  onRespond: (requestId: string, response: AgentPermissionResponse) => Promise<void>;
}

type PermissionResponseSender = (
  response: AgentPermissionResponse,
  actionId: string,
) => Promise<void>;

function actionVariant(variant?: "primary" | "secondary" | "danger") {
  if (variant === "primary") return "default" as const;
  if (variant === "secondary") return "secondary" as const;
  if (variant === "danger") return "destructive" as const;
  return "outline" as const;
}

function PermissionActionContent({ pending, label }: { pending: boolean; label: string }) {
  return (
    <>
      {pending && <LoaderCircle className="animate-spin" />}
      {label}
    </>
  );
}

function PermissionDetail({ request }: { request: AgentPermissionRequest }) {
  const { t } = useTranslation();
  const plan = getPermissionPlanText(request);
  if (plan) {
    return (
      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-[var(--foreground-subtle)] uppercase">
          {t("workspace.permissions.proposedPlan")}
        </p>
        <MarkdownContent className="text-[13px]">{plan}</MarkdownContent>
      </div>
    );
  }

  const detail = request.detail;
  if (!detail) return null;

  if (detail.type === "shell") {
    return (
      <div className="mt-3 space-y-1.5">
        {detail.cwd && (
          <p className="break-all font-mono text-[11px] text-[var(--foreground-faint)]">
            {detail.cwd}
          </p>
        )}
        <CodeBlock code={detail.command} language="bash" />
      </div>
    );
  }

  if (detail.type === "edit" && detail.unifiedDiff) {
    return (
      <div className="mt-3 space-y-1.5">
        <p className="break-all font-mono text-[12px] text-[var(--foreground-subtle)]">
          {toolCallSummary(request.name, detail)}
        </p>
        <CodeBlock code={detail.unifiedDiff} language="diff" />
      </div>
    );
  }

  if (detail.type === "plain_text" && detail.text) {
    return (
      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3 text-[13px] leading-relaxed text-[var(--foreground-muted)] whitespace-pre-wrap break-words">
        {detail.text}
      </div>
    );
  }

  if (detail.type === "unknown") {
    return (
      <div className="mt-3">
        <CodeBlock
          code={JSON.stringify(detail.input, null, 2) ?? String(detail.input)}
          language="json"
        />
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2 font-mono text-[12px] text-[var(--foreground-subtle)] break-all">
      {toolCallSummary(request.name, detail)}
    </div>
  );
}

function QuestionOption({
  requestId,
  question,
  questionIndex,
  optionIndex,
  selected,
  disabled,
  onToggle,
}: {
  requestId: string;
  question: PermissionQuestion;
  questionIndex: number;
  optionIndex: number;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const option = question.options[optionIndex];
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors",
        selected
          ? "border-[var(--primary)] bg-[var(--surface-soft)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)]",
        disabled && "cursor-default opacity-60",
      )}
    >
      <input
        type={question.multiSelect ? "checkbox" : "radio"}
        name={`${requestId}:${questionIndex}`}
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-[var(--foreground)]">{option.label}</span>
        {option.description && (
          <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--foreground-subtle)]">
            {option.description}
          </span>
        )}
      </span>
    </label>
  );
}

function QuestionPermissionForm({
  request,
  questions,
  pendingActionId,
  sendResponse,
}: {
  request: AgentPermissionRequest;
  questions: PermissionQuestion[];
  pendingActionId: string | null;
  sendResponse: PermissionResponseSender;
}) {
  const { t } = useTranslation();
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});
  const [freeform, setFreeform] = useState<PermissionQuestionFreeform>({});

  const pending = pendingActionId !== null;
  const answered = arePermissionQuestionsAnswered(questions, selections, freeform);
  const dismissLabel =
    questions.find((question) => question.dismissLabel)?.dismissLabel ??
    t("workspace.permissions.dismiss");

  function toggleOption(questionIndex: number, optionIndex: number, multiSelect: boolean) {
    setSelections((current) => {
      const next = new Set(current[questionIndex] ?? []);
      if (multiSelect) {
        if (next.has(optionIndex)) next.delete(optionIndex);
        else next.add(optionIndex);
      } else {
        next.clear();
        next.add(optionIndex);
      }
      return { ...current, [questionIndex]: next };
    });
    setFreeform((current) => {
      if (!current[questionIndex]) return current;
      const next = { ...current };
      delete next[questionIndex];
      return next;
    });
  }

  function updateFreeform(questionIndex: number, value: string) {
    setFreeform((current) => ({ ...current, [questionIndex]: value }));
    if (value.length === 0) return;
    setSelections((current) => {
      if ((current[questionIndex]?.size ?? 0) === 0) return current;
      return { ...current, [questionIndex]: new Set<number>() };
    });
  }

  return (
    <div className="mt-3 space-y-3">
      {questions.map((question, questionIndex) => {
        const selected = selections[questionIndex] ?? new Set<number>();
        const showFreeform = questionShowsFreeform(question);
        return (
          <fieldset
            key={`${question.header}:${questionIndex}`}
            className="space-y-2"
            disabled={pending}
          >
            <legend className="text-[13px] font-medium text-[var(--foreground)]">
              {question.question}
              {question.allowEmpty && (
                <span className="ml-1.5 font-normal text-[var(--foreground-faint)]">
                  {t("workspace.permissions.optional")}
                </span>
              )}
            </legend>
            {question.options.length > 0 && (
              <div
                className="grid gap-2 sm:grid-cols-2"
                role={question.multiSelect ? "group" : "radiogroup"}
                aria-label={question.question}
              >
                {question.options.map((option, optionIndex) => (
                  <QuestionOption
                    key={`${option.label}:${optionIndex}`}
                    requestId={request.id}
                    question={question}
                    questionIndex={questionIndex}
                    optionIndex={optionIndex}
                    selected={selected.has(optionIndex)}
                    disabled={pending}
                    onToggle={() => toggleOption(questionIndex, optionIndex, question.multiSelect)}
                  />
                ))}
              </div>
            )}
            {showFreeform && (
              <Textarea
                value={freeform[questionIndex] ?? ""}
                disabled={pending}
                rows={2}
                placeholder={
                  question.placeholder ??
                  t(
                    question.options.length > 0
                      ? "workspace.permissions.otherPlaceholder"
                      : "workspace.permissions.answerPlaceholder",
                  )
                }
                aria-label={question.question}
                onChange={(event) => updateFreeform(questionIndex, event.target.value)}
                className="min-h-12 resize-y bg-[var(--surface-panel)] text-[13px]"
              />
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={pending || !answered}
          onClick={() =>
            void sendResponse(
              buildPermissionQuestionResponse(request.input, questions, selections, freeform),
              "submit",
            )
          }
        >
          <PermissionActionContent
            pending={pendingActionId === "submit"}
            label={t("workspace.permissions.submit")}
          />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void sendResponse(
              shouldSubmitEmptyPermissionQuestions(questions)
                ? buildPermissionQuestionResponse(request.input, questions, selections, freeform)
                : {
                    behavior: "deny",
                    message: t("workspace.permissions.dismissedByUser"),
                  },
              "dismiss",
            )
          }
        >
          <PermissionActionContent pending={pendingActionId === "dismiss"} label={dismissLabel} />
        </Button>
      </div>
    </div>
  );
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: AgentPermissionRequest;
  onRespond: PermissionRequestsProps["onRespond"];
}) {
  const { t } = useTranslation();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendResponse(response: AgentPermissionResponse, actionId: string) {
    setPendingActionId(actionId);
    setError(null);
    try {
      await onRespond(request.id, response);
    } catch (cause) {
      setError(
        t("workspace.permissions.respondFailed", {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      setPendingActionId(null);
    }
  }

  const actions = request.actions ?? [];
  const suggestions = request.suggestions ?? [];
  const questions = useMemo(
    () => (request.kind === "question" ? parsePermissionQuestions(request.input) : null),
    [request.input, request.kind],
  );
  const hasUnsupportedQuestion = request.kind === "question" && questions === null;

  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--warning)]/40 bg-[var(--surface-panel)] p-3.5">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-[var(--warning)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-[var(--foreground)]">
            {request.title ?? request.name}
          </p>
          {request.description && (
            <p className="mt-0.5 break-words text-[13px] leading-relaxed text-[var(--foreground-muted)] whitespace-pre-wrap">
              {request.description}
            </p>
          )}
        </div>
      </div>

      {questions ? (
        <QuestionPermissionForm
          request={request}
          questions={questions}
          pendingActionId={pendingActionId}
          sendResponse={sendResponse}
        />
      ) : (
        <>
          <PermissionDetail request={request} />
          {hasUnsupportedQuestion && (
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--danger)]" role="alert">
              {t("workspace.permissions.unsupportedQuestion")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasUnsupportedQuestion ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingActionId !== null}
                onClick={() =>
                  void sendResponse(
                    {
                      behavior: "deny",
                      message: t("workspace.permissions.dismissedByUser"),
                    },
                    "dismiss",
                  )
                }
              >
                <PermissionActionContent
                  pending={pendingActionId === "dismiss"}
                  label={t("workspace.permissions.dismiss")}
                />
              </Button>
            ) : actions.length > 0 ? (
              actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={actionVariant(action.variant)}
                  disabled={pendingActionId !== null}
                  onClick={() =>
                    void sendResponse(
                      buildPermissionActionResponse(
                        action,
                        action.intent === "dismiss"
                          ? t("workspace.permissions.dismissedByUser")
                          : t("workspace.permissions.deniedByUser"),
                      ),
                      action.id,
                    )
                  }
                >
                  <PermissionActionContent
                    pending={pendingActionId === action.id}
                    label={action.label}
                  />
                </Button>
              ))
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={pendingActionId !== null}
                  onClick={() => void sendResponse({ behavior: "allow" }, "allow-once")}
                >
                  <PermissionActionContent
                    pending={pendingActionId === "allow-once"}
                    label={
                      suggestions.length > 0
                        ? t("workspace.permissions.allowOnce")
                        : t("workspace.permissions.allow")
                    }
                  />
                </Button>
                {suggestions.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pendingActionId !== null}
                    onClick={() =>
                      void sendResponse(
                        buildRememberedPermissionResponse(suggestions),
                        "allow-remember",
                      )
                    }
                  >
                    <PermissionActionContent
                      pending={pendingActionId === "allow-remember"}
                      label={t("workspace.permissions.allowAndRemember")}
                    />
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingActionId !== null}
                  onClick={() =>
                    void sendResponse(
                      {
                        behavior: "deny",
                        message: t("workspace.permissions.deniedByUser"),
                      },
                      "deny",
                    )
                  }
                >
                  <PermissionActionContent
                    pending={pendingActionId === "deny"}
                    label={t("workspace.permissions.deny")}
                  />
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {suggestions.length > 0 &&
        questions === null &&
        !hasUnsupportedQuestion &&
        actions.length === 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--foreground-faint)]">
            <Check size={12} className="mt-0.5 shrink-0" />
            {t("workspace.permissions.rememberHint")}
          </p>
        )}
      {error && (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function PermissionRequests({ requests, onRespond }: PermissionRequestsProps) {
  if (requests.length === 0) return null;
  return (
    <div className="space-y-2">
      {requests.map((request) => (
        <PermissionCard key={request.id} request={request} onRespond={onRespond} />
      ))}
    </div>
  );
}
