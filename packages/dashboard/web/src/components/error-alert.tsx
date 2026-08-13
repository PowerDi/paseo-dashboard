import { TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Replaces window.alert for action failures — same call shape, in-app chrome. */
type ShowError = (message: string) => void;

const ErrorAlertContext = createContext<ShowError | null>(null);

export function useErrorAlert(): ShowError {
  const show = useContext(ErrorAlertContext);
  if (!show) throw new Error("useErrorAlert must be used inside ErrorAlertProvider");
  return show;
}

export function ErrorAlertProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback<ShowError>((next) => setMessage(next), []);
  const value = useMemo(() => show, [show]);

  return (
    <ErrorAlertContext.Provider value={value}>
      {children}
      <AlertDialog
        open={message !== null}
        onOpenChange={(open) => {
          if (!open) setMessage(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert className="text-[var(--danger)]" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("common.errorTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction size="sm">{t("common.ok")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ErrorAlertContext.Provider>
  );
}
