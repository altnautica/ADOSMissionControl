"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

type ToastStatus = "success" | "warning" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  status: ToastStatus;
}

interface ToastContextValue {
  toast: (message: string, status?: ToastStatus) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/**
 * How long a toast stays up. Warnings and errors are the alert popups the
 * operator sets a duration for ("never" keeps them until dismissed); info and
 * success confirmations always clear after 3 s.
 */
export function toastLifetimeMs(status: ToastStatus, alertPopupDuration: string): number | null {
  if (status !== "warning" && status !== "error") return 3000;
  if (alertPopupDuration === "never") return null;
  const seconds = Number(alertPopupDuration);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3000;
}

const borderColors: Record<ToastStatus, string> = {
  success: "border-l-status-success",
  warning: "border-l-status-warning",
  error: "border-l-status-error",
  info: "border-l-accent-primary",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, status: ToastStatus = "info") => {
    const id = randomId();
    setToasts((prev) => [...prev, { id, message, status }]);
    const lifetime = toastLifetimeMs(status, useSettingsStore.getState().alertPopupDuration);
    if (lifetime !== null) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, lifetime);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // The three dismiss labels were hardcoded English accessible names, so on a
  // non-English locale the only control on an error toast announced in the
  // wrong language.
  const tToast = useTranslations("toast");

  // Separate the polite from the assertive container so screen readers
  // receive errors and warnings immediately while info/success updates
  // queue politely. Warnings mirror errors here because mesh transient
  // events (receiver unreachable, relay disconnected) fire at warning
  // severity and a pilot needs to hear them right away, not after a
  // chatty info toast drains out of the polite queue.
  const isAssertive = (status: ToastStatus) =>
    status === "error" || status === "warning";
  const politeToasts = toasts.filter((t) => !isAssertive(t.status));
  const assertiveToasts = toasts.filter((t) => isAssertive(t.status));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {politeToasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border-default border-l-2 min-w-[240px]",
                borderColors[t.status]
              )}
            >
              <span className="text-xs text-text-primary flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label={tToast("dismiss")}
                className="text-text-tertiary hover:text-text-primary focus-ring"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {assertiveToasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border-default border-l-2 min-w-[240px]",
                borderColors[t.status]
              )}
            >
              <span className="text-xs text-text-primary flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label={
                  t.status === "warning"
                    ? tToast("dismissWarning")
                    : tToast("dismissError")
                }
                className="text-text-tertiary hover:text-text-primary focus-ring"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
