"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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

/**
 * Open modals. Only the top-most one handles Escape and the Tab trap, so
 * Escape in a dialog stacked on another (a confirm over a form) closes just
 * that dialog. A modal rendered inside another is above it (depth, from
 * context, so it holds even when both open in the same commit and the inner
 * one registers first); among equal depths the later-opened one is on top.
 */
interface OpenModal {
  depth: number;
  seq: number;
}
const openModals = new Set<OpenModal>();
let openSeq = 0;
const ModalDepthContext = createContext(0);

function isTopModal(entry: OpenModal): boolean {
  for (const other of openModals) {
    if (other.depth > entry.depth || (other.depth === entry.depth && other.seq > entry.seq)) {
      return false;
    }
  }
  return true;
}

/** The focused element, or null during server render. */
function activeElementOrNull(): HTMLElement | null {
  return typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
}

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
  const depth = useContext(ModalDepthContext) + 1;
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The element to hand focus back to on close, captured while rendering the
  // open transition: by the time an effect runs, a child's `autoFocus` has
  // already moved focus into the dialog.
  const [restoreTarget, setRestoreTarget] = useState<HTMLElement | null>(() =>
    open ? activeElementOrNull() : null,
  );
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRestoreTarget(activeElementOrNull());
  }
  // Read through refs so a parent re-render with a new onClose does not
  // re-register the modal and reorder the stack, and a changed focus target
  // does not re-run the open-time focus move.
  const onCloseRef = useRef(onClose);
  const closeBlockedRef = useRef(closeBlocked);
  const initialFocusRefRef = useRef(initialFocusRef);
  const restoreTargetRef = useRef(restoreTarget);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeBlockedRef.current = closeBlocked;
    initialFocusRefRef.current = initialFocusRef;
    restoreTargetRef.current = restoreTarget;
  });

  useEffect(() => {
    if (!open) return;
    const entry: OpenModal = { depth, seq: ++openSeq };
    openModals.add(entry);
    const handler = (e: KeyboardEvent) => {
      if (!isTopModal(entry)) return;
      if (e.key === "Escape") {
        // A control inside the dialog (an open Select) already consumed it.
        if (e.defaultPrevented || closeBlockedRef.current) return;
        onCloseRef.current();
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
    return () => {
      document.removeEventListener("keydown", handler);
      openModals.delete(entry);
    };
  }, [open, depth]);

  // Move focus into the dialog once, on open, and restore it on close, so
  // keyboard users are not left stranded behind the modal. A child that
  // already took focus (an `autoFocus` input) keeps it.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node?.contains(document.activeElement)) {
      const target =
        initialFocusRefRef.current?.current ??
        node?.querySelector<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
      (target ?? node)?.focus();
    }
    const restore = restoreTargetRef.current;
    return () => restore?.focus?.();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <ModalDepthContext.Provider value={depth}>
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
      </div>
    </ModalDepthContext.Provider>,
    document.body
  );
}
