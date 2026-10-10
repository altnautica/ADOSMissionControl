"use client";

/**
 * The safety band's `PREFLIGHT n/m` chip. Counts the checklist session that
 * belongs to this drone: a session opened for another aircraft never vouches
 * for this one, so its count renders as no data. Clicking opens the shared
 * pre-flight checklist in a popover anchored under the chip.
 *
 * The popover is portalled into the cockpit root rather than rendered inside
 * the band, so it sits on the sheet layer above the alert stack instead of
 * inheriting the band's stacking context.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ClipboardCheck, X } from "lucide-react";
import { useChecklistStore } from "@/stores/checklist-store";
import { PreFlightChecklist } from "@/components/flight/PreFlightChecklist";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

interface PopoverSlot {
  host: HTMLElement;
  top: number;
  right: number;
}

export function PreflightChip({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.band");
  const total = useChecklistStore((s) => s.items.length);
  const ownsSession = useChecklistStore((s) => s.droneId === droneId);
  const done = useChecklistStore((s) =>
    s.items.filter((i) => i.status === "pass" || i.status === "skipped").length,
  );
  const failed = useChecklistStore((s) => s.items.some((i) => i.status === "fail"));

  const anchorRef = useRef<HTMLButtonElement>(null);
  const [slot, setSlot] = useState<PopoverSlot | null>(null);
  const close = useCallback(() => setSlot(null), []);

  const toggle = () => {
    if (slot) {
      close();
      return;
    }
    const anchor = anchorRef.current;
    const host = anchor?.closest<HTMLElement>(".ados-cockpit") ?? document.body;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setSlot({ host, top: a.bottom - h.top + 6, right: Math.max(8, h.right - a.right) });
  };

  useEffect(() => {
    if (!slot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slot, close]);

  const ready = ownsSession && done === total;
  const color = !ownsSession
    ? "var(--hud-ink-2)"
    : failed
      ? "var(--hud-crit)"
      : ready
        ? "var(--hud-good)"
        : "var(--hud-warn)";

  return (
    <div className="stat" data-testid="cockpit-preflight">
      <button
        ref={anchorRef}
        type="button"
        onClick={toggle}
        aria-expanded={slot !== null}
        aria-haspopup="dialog"
        title={t("preflightTitle")}
        className="pointer-events-auto flex items-center gap-1.5 transition-colors duration-200 ease-out"
        style={{ color, background: "none", border: 0, cursor: "pointer" }}
      >
        <ClipboardCheck size={13} aria-hidden="true" />
        <span className="v tabular-nums" style={{ color: "inherit", fontSize: 11 }}>
          {t("preflight", { done: ownsSession ? String(done) : NO_DATA_GLYPH, total })}
        </span>
      </button>
      {slot &&
        createPortal(
          <div
            role="dialog"
            aria-label={t("preflightTitle")}
            className="glass-panel pointer-events-auto absolute flex w-80 max-w-[90%] flex-col overflow-hidden"
            style={{ top: slot.top, right: slot.right, zIndex: 50, maxHeight: "70%" }}
          >
            <div className="flex justify-end px-2 pt-1.5">
              <button
                type="button"
                onClick={close}
                aria-label={t("preflightClose")}
                style={{ color: "var(--hud-ink-2)", background: "none", border: 0, cursor: "pointer" }}
              >
                <X size={12} />
              </button>
            </div>
            <PreFlightChecklist className="min-h-0 flex-1" />
          </div>,
          slot.host,
        )}
    </div>
  );
}
