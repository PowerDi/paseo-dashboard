import { ArrowUp, LoaderCircle } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

interface ComposerShellProps {
  label: string;
  /** Context chips rendered in the protrusion bar welded to the top of the card. */
  bar?: ReactNode;
  /** Quiet text on the left of the action row (keyboard hint, inline error). */
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Composer chrome shared by the active-session and new-session composers:
 * protrusion bar, input card, and a dedicated action row so the send button
 * never sits on top of the text.
 */
export function ComposerShell({ label, bar, hint, actions, children }: ComposerShellProps) {
  return (
    <footer className="workspace-composer" aria-label={label}>
      {bar ? <div className="composer-bar">{bar}</div> : null}
      <div className={cn("composer-card", bar && "is-attached")}>
        {children}
        <div className="composer-actions">
          {hint ? <span className="composer-actions-hint">{hint}</span> : null}
          <span className="composer-actions-spacer" />
          {actions}
        </div>
      </div>
    </footer>
  );
}

interface ComposerFieldProps {
  ref: Ref<HTMLTextAreaElement>;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ComposerField({
  ref,
  label,
  placeholder,
  value,
  disabled,
  onChange,
  onSubmit,
}: ComposerFieldProps) {
  return (
    <textarea
      ref={ref}
      className="composer-field"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        onSubmit();
      }}
    />
  );
}

export function ComposerSendButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="composer-send" aria-label={label} disabled={disabled} onClick={onClick}>
      {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={17} />}
    </button>
  );
}
