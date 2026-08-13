import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PermissionRequestsProps {
  requests: readonly AgentPermissionRequest[];
  onRespond: (requestId: string, response: AgentPermissionResponse) => Promise<void>;
}

function actionVariant(variant?: "primary" | "secondary" | "danger") {
  if (variant === "primary") return "default" as const;
  if (variant === "danger") return "destructive" as const;
  return "outline" as const;
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: AgentPermissionRequest;
  onRespond: PermissionRequestsProps["onRespond"];
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  async function respond(response: AgentPermissionResponse) {
    setPending(true);
    try {
      await onRespond(request.id, response);
    } catch (error) {
      window.alert(
        t("workspace.permissions.respondFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      setPending(false);
    }
  }

  const actions = request.actions ?? [];

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--warning)]/40 bg-[var(--surface-panel)] p-3.5">
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
      <div className={cn("mt-3 flex flex-wrap items-center gap-2")}>
        {actions.length > 0 ? (
          actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant={actionVariant(action.variant)}
              disabled={pending}
              onClick={() =>
                void respond(
                  action.behavior === "allow"
                    ? { behavior: "allow", selectedActionId: action.id }
                    : {
                        behavior: "deny",
                        selectedActionId: action.id,
                        message: "Denied by user",
                      },
                )
              }
            >
              {action.label}
            </Button>
          ))
        ) : (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={pending}
              onClick={() => void respond({ behavior: "allow" })}
            >
              {t("workspace.permissions.allow")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void respond({ behavior: "deny", message: "Denied by user" })}
            >
              {t("workspace.permissions.deny")}
            </Button>
          </>
        )}
      </div>
    </div>
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
