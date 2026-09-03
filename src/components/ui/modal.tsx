"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** `alertdialog` for a dialog that interrupts to confirm a consequential or
   * destructive action, so assistive tech announces it as an alert rather than
   * an ordinary dialog. Defaults to `dialog`. */
  role?: "dialog" | "alertdialog";
  /** Element to receive focus on open. Defaults to the first focusable node,
   * which for a destructive confirmation is the wrong choice — point this at
   * the cancel control so a stray Enter cannot commit the action. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  className?: string;
  /** Modal width preset. Sized to keep the per-modal width policy in
   * one place rather than scattered className strings.
   * - `sm` ~480px
   * - `md` ~640px (default for most dialogs)
   * - `lg` ~960px
   * - `xl` ~1280px wide / 90vh tall (plugin install review surface)
   *
   * When `xl` is set, the modal also fills 90% of viewport height so a
   * single dense panel can carry both columns of audit data without
   * page scroll on a 13" laptop. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Suppress the click-on-backdrop dismissal. The X button and the
   * Escape key still close. Defaults to false so existing modals keep
   * the standard behaviour. */
  disableBackdropClose?: boolean;
  /** When true, suppress the default `p-4` body padding so the child can
   * own its own layout (e.g. an internal flex column with its own
   * sticky header + scrollable middle + sticky footer). */
  noBodyPadding?: boolean;
  /** When true, suppress BOTH the Escape-key dismissal and the X close
   * button click. Useful while a destructive in-flight operation is
   * running (an install kickoff that's already in flight on the agent
   * shouldn't be discardable just because the dialog gets closed). The
   * backdrop click is independently gated by `disableBackdropClose`. */
  closeBlocked?: boolean;
  /** Hide the chrome title bar entirely. The child renders its own
   * header (e.g. a sticky strip with its own title + close affordance). */
  hideTitleBar?: boolean;
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  // 1280px target width, 32px viewport gutter on small screens, 90vh
  // tall so the single panel can host header + two columns + footer.
  // The inner grid is `grid-rows-[auto_1fr_auto]` so the child's
  // sticky regions pin without fighting the modal frame.
  xl: "max-w-[1280px] w-[calc(100vw-32px)] h-[90vh] grid grid-rows-[auto_1fr_auto]",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  size = "md",
  role = "dialog",
  initialFocusRef,
  disableBackdropClose,
  noBodyPadding,
  closeBlocked,
  hideTitleBar,
}: ModalProps) {
  const t = useTranslations("common");
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (closeBlocked) return;
        onClose();
        return;
      }
      // Focus trap: keep Tab within the dialog's focusable elements.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, closeBlocked]);

  // Move focus into the dialog on open and restore it to the previously focused
  // element on close, so keyboard users are not left stranded behind the modal.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const target =
      initialFocusRef?.current ??
      node?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
    (target ?? node)?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (disableBackdropClose || closeBlocked) return;
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "bg-bg-secondary border border-border-default w-full mx-4 outline-none",
          SIZE_CLASS[size],
          className,
        )}
      >
        {!hideTitleBar && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <button
              type="button"
              onClick={() => {
                if (closeBlocked) return;
                onClose();
              }}
              disabled={closeBlocked}
              aria-disabled={closeBlocked}
              // The X carried no accessible name, so all 20+ consumers of the
              // shared Modal shipped an unlabelled close control that a screen
              // reader announced only as "button".
              aria-label={t("close")}
              className={cn(
                "transition-colors focus-ring",
                closeBlocked
                  ? "text-text-tertiary/40 cursor-not-allowed"
                  : "text-text-tertiary hover:text-text-primary",
              )}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div
          className={cn(
            noBodyPadding ? undefined : "p-4",
            // `xl` modals own their own scrollable layout via the
            // child's two-column grid; the body just needs to be the
            // overflow-hidden middle of the modal frame so the inner
            // sticky header + footer pin against the viewport rather
            // than the page.
            size === "xl" && "min-h-0 overflow-hidden",
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
