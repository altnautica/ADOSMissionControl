"use client";

/**
 * The Menu's `PREFLIGHT n/m` chip: the shared spec pre-flight checklist
 * (`flow.preflight.*`, the same items as every cockpit) for this drone. A
 * checklist evaluated for another aircraft never vouches for this one, so its
 * count renders as no data. Clicking opens the list in a popover anchored
 * under the chip, with one footer button: "Checks done" passes the first-arm
 * gate once no item fails; while one fails it reads "Fix the failing checks"
 * and stays disabled.
 *
 * The popover is portalled into the cockpit root rather than rendered inside
 * the Menu, so it sits on the sheet layer instead of inheriting the Menu's
 * stacking context.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ClipboardCheck, TriangleAlert, X } from "lucide-react";
import { checklistReadyFor, useChecklistStore } from "@/stores/checklist-store";
import { firstArmAllowed, type PreflightState } from "@/lib/cockpit/preflight";
import { specString } from "@/lib/cockpit/spec-strings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

interface PopoverSlot {
  host: HTMLElement;
  top: number;
  right: number;
}

const STATE_COLOR: Record<PreflightState, string> = {
  pass: "var(--hud-good)",
  warn: "var(--hud-warn)",
  fail: "var(--hud-crit)",
};

export function PreflightChip({ droneId }: { droneId: string }) {
  const ownsSession = useChecklistStore((s) => s.droneId === droneId);
  const items = useChecklistStore((s) => (s.droneId === droneId ? s.preflight : null));
  const passed = useChecklistStore((s) => checklistReadyFor(s, droneId));
  const passPreflight = useChecklistStore((s) => s.passPreflight);

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

  const total = items?.length ?? 0;
  const ok = items?.filter((i) => i.state !== "fail").length ?? 0;
  const allowed = items !== null && firstArmAllowed(items);
  const color = !ownsSession || items === null
    ? "var(--hud-ink-2)"
    : !allowed
      ? "var(--hud-crit)"
      : passed
        ? "var(--hud-good)"
        : "var(--hud-warn)";
  const title = specString("flow.preflight.title");

  return (
    <div className="stat" data-testid="cockpit-preflight">
      <button
        ref={anchorRef}
        type="button"
        onClick={toggle}
        aria-expanded={slot !== null}
        aria-haspopup="dialog"
        title={title}
        className="fs-hit pointer-events-auto flex items-center gap-1.5 transition-colors duration-200 ease-out"
        style={{ color, background: "none", border: 0, cursor: "pointer" }}
      >
        <ClipboardCheck size={13} aria-hidden="true" />
        <span className="v tabular-nums" style={{ color: "inherit", fontSize: 11 }}>
          {items === null ? NO_DATA_GLYPH : `${ok}/${total}`}
        </span>
      </button>
      {slot &&
        createPortal(
          <div
            role="dialog"
            aria-label={title}
            data-testid="preflight-sheet"
            className="fs-panel pointer-events-auto absolute flex w-80 max-w-[90%] flex-col gap-2 overflow-hidden p-3"
            style={{ top: slot.top, right: slot.right, zIndex: 50, maxHeight: "70%" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold">{title}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={specString("cockpit.close")}
                className="grid min-h-12 min-w-12 place-items-center"
                style={{ color: "var(--hud-ink-2)", background: "none", border: 0, cursor: "pointer" }}
              >
                <X size={14} />
              </button>
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-[12px]" data-testid="preflight-items">
              {(items ?? []).map((item) => (
                <li key={item.id} data-state={item.state} className="flex items-center gap-2">
                  {item.state === "pass" ? (
                    <Check size={13} aria-hidden="true" style={{ color: STATE_COLOR.pass }} />
                  ) : (
                    <TriangleAlert size={13} aria-hidden="true" style={{ color: STATE_COLOR[item.state] }} />
                  )}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              data-testid="preflight-done"
              disabled={!allowed || passed}
              onClick={() => {
                if (passPreflight(droneId)) close();
              }}
              className="min-h-12 rounded-md px-3 text-xs font-semibold disabled:opacity-50"
              style={{ background: "color-mix(in srgb, var(--fs-text) 12%, transparent)", color: "var(--fs-text)", border: 0, cursor: allowed ? "pointer" : "default" }}
            >
              {allowed ? specString("flow.preflight.done") : specString("flow.preflight.fix")}
            </button>
          </div>,
          slot.host,
        )}
    </div>
  );
}
