"use client";

import { useTranslations } from "next-intl";
import { useState, useRef, useLayoutEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import { cn } from "@/lib/utils";

const VIEWPORT_MARGIN = 8;
const CLOSE_DELAY_MS = 120;

/**
 * Hover tooltip for parameter names: metadata + optional external docs link.
 * Renders via portal to document.body so virtualized grid rows (overflow /
 * stacking) do not clip or cover the panel.
 */
export function ParamTooltip({
  meta,
  docUrl,
  docsLinkLabel = "ArduPilot docs",
  children,
}: {
  meta: ParamMetadata | undefined;
  docUrl?: string | null;
  docsLinkLabel?: string;
  children: React.ReactNode;
}) {
  const tr = useTranslations("fcPanels.paramTooltip");
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const hasMeta = Boolean(meta && (meta.humanName || meta.description));
  const hasContent = hasMeta || Boolean(docUrl);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setShow(false), CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const open = useCallback(() => {
    clearCloseTimer();
    setShow(true);
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!show || !triggerRef.current) return;

    const update = () => {
      const trigger = triggerRef.current;
      const overlay = overlayRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const ow = overlay?.offsetWidth ?? 280;
      const oh = overlay?.offsetHeight ?? 120;
      let top = rect.bottom + 4;
      let left = rect.left;
      if (top + oh > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - oh - 4);
      }
      if (left + ow > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - ow);
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      setPos({ top, left });
    };

    update();
    // Re-measure after paint when overlay has real size
    const raf = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [show, meta, docUrl]);

  if (!hasContent) {
    return <>{children}</>;
  }

  const overlay =
    show &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={overlayRef}
        id={tooltipId}
        role="tooltip"
        className={cn(
          "fixed z-[9999] max-w-[300px] whitespace-normal bg-bg-tertiary border border-border-default",
          "px-2.5 py-2 text-[10px] leading-relaxed shadow-lg pointer-events-auto",
        )}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999, visibility: "hidden" }}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
      >
        {meta?.humanName && (
          <div className="font-semibold text-text-primary mb-0.5">{meta.humanName}</div>
        )}
        {meta?.description && (
          <div className="text-text-secondary">{meta.description}</div>
        )}
        {meta?.range && (
          <div className="text-text-tertiary mt-1">
            Range: {meta.range.min} &ndash; {meta.range.max}
            {meta.units ? ` ${meta.units}` : ""}
          </div>
        )}
        {meta?.units && !meta?.range && (
          <div className="text-text-tertiary mt-1">Units: {meta.units}</div>
        )}
        {meta?.defaultValue !== undefined && (
          <div className="text-text-tertiary mt-1">Default: {meta.defaultValue}</div>
        )}
        {meta?.increment && (
          <div className="text-text-tertiary mt-0.5">Step: {meta.increment}</div>
        )}
        {meta?.rebootRequired && (
          <div className="text-status-warning mt-1">{tr("rebootRequiredAfterChange")}</div>
        )}
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-accent-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {docsLinkLabel}
            <ExternalLink size={9} />
          </a>
        )}
      </div>,
      document.body,
    );

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex min-w-0 max-w-full"
        aria-describedby={show ? tooltipId : undefined}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={scheduleClose}
      >
        {children}
      </span>
      {overlay}
    </>
  );
}
