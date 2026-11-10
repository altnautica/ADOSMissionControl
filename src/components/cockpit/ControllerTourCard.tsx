"use client";

/**
 * @module cockpit/ControllerTourCard
 * @description The controller tour on the flight screen: three cards
 * (sticks, safety buttons, skills) in a small panel beside the left column,
 * below the top bar, so it never covers STOP or the left column. No scrim:
 * the rest of the screen keeps working. It shows once per device
 * (`tourSeen`), only while a usable pad is connected and the drone is on the
 * ground; Skip, Close and Done all mark it seen, and Settings › Controls ›
 * Replay controller tour shows it again. While it is on screen the tips wait
 * (`tourVisible`).
 *
 * The pad drives it: D-pad left / right (or up / down) moves the focus
 * between Skip and Next, Cross presses the focused button. The keyboard:
 * Tab and Enter, the arrow keys, Escape closes.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { sheetPlacement } from "@/components/cockpit/flight/flight-sheet";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";

/** The tour cards, in order (`controls.tour.<id>.title` / `.body`). */
export const TOUR_CARDS = ["sticks", "safety", "skills"] as const;

/** Whether the drone is flying: the pilot's `armed && !landed`, else the
 *  heartbeat's armed state. */
export function tourAirborne(pilot: { armed: boolean; landed: boolean } | null, heartbeatArmed: boolean): boolean {
  return pilot ? pilot.armed && !pilot.landed : heartbeatArmed;
}

type Focus = "skip" | "next";

export function ControllerTourCard({ droneId }: { droneId: string }) {
  const grid = useFlightGrid();
  const { pilot } = usePilotState(droneId);
  const heartbeatArmed = useDroneStore((s) => s.armState === "armed");
  const padUsable = usePadStatusStore((s) => s.connected && s.usable);
  const seen = useControlsStore((s) => s.tourSeen);
  const markSeen = useControlsStore((s) => s.markTourSeen);
  const setTourVisible = useControlsStore((s) => s.setTourVisible);
  const [card, setCard] = useState(0);
  const [focus, setFocus] = useState<Focus>("next");

  const visible = padUsable && !seen && !tourAirborne(pilot, heartbeatArmed);
  const last = card === TOUR_CARDS.length - 1;

  useEffect(() => {
    setTourVisible(visible);
  }, [visible, setTourVisible]);
  useEffect(() => () => setTourVisible(false), [setTourVisible]);

  const latest = useRef({ visible, last, focus });
  useEffect(() => {
    latest.current = { visible, last, focus };
  });

  // Skip, Close and Done end the tour; a replay starts at the first card.
  const finish = useCallback(() => {
    markSeen();
    setCard(0);
    setFocus("next");
  }, [markSeen]);
  const press = (f: Focus) => {
    if (f === "skip" || last) finish();
    else setCard((c) => c + 1);
  };

  // The pad: rising edges only.
  useEffect(
    () =>
      useInputStore.subscribe((s, prev) => {
        const L = latest.current;
        if (!L.visible || s.buttons === prev.buttons) return;
        const edge = (c: string) => s.buttons[WEB_BUTTON_INDEX[c]] === true && prev.buttons[WEB_BUTTON_INDEX[c]] !== true;
        if (edge("dpad_left") || edge("dpad_up")) setFocus("skip");
        else if (edge("dpad_right") || edge("dpad_down")) setFocus("next");
        else if (edge("cross")) {
          if (L.focus === "skip" || L.last) finish();
          else setCard((c) => c + 1);
        }
      }),
    [finish],
  );

  if (!visible) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocus("skip");
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setFocus("next");
    }
  };

  const id = TOUR_CARDS[card];
  const btn = (f: Focus) => ({
    "data-focused": focus === f ? "true" : undefined,
    onFocus: () => setFocus(f),
    style: {
      minHeight: 48,
      minWidth: 48,
      padding: "0 12px",
      borderRadius: "var(--fs-radius-sm, 8px)",
      border: "var(--fs-border-px, 1px) solid var(--fs-border)",
      outline: focus === f ? "2px solid var(--fs-text)" : undefined,
      outlineOffset: 2,
      background: f === "next" ? "var(--fs-border)" : "transparent",
      color: "var(--fs-text)",
      fontWeight: 600,
    },
  });

  return (
    <section
      role="region"
      aria-label={specString("controls.tour.title")}
      data-testid="controls-tour"
      data-card={id}
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        zIndex: 40,
        ...sheetPlacement(grid, "left"),
        width: 300,
        maxWidth: "calc(100% - 16px)",
        pointerEvents: "auto",
        background: "var(--fs-bg)",
        backdropFilter: "blur(var(--fs-blur, 16px))",
        border: "var(--fs-border-px, 1px) solid var(--fs-border)",
        borderRadius: "var(--fs-radius, 12px)",
        color: "var(--fs-text)",
        padding: "var(--fs-pad, 10px)",
        fontSize: 13,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ fontWeight: 600, fontSize: 13 }}>{specString(`controls.tour.${id}.title`)}</h3>
        <button
          type="button"
          aria-label={specString("cockpit.close")}
          data-testid="controls-tour-close"
          onClick={finish}
          style={{ minHeight: 48, minWidth: 48, color: "var(--fs-text-dim)", background: "transparent" }}
        >
          ×
        </button>
      </header>
      <p style={{ marginTop: 4, color: "var(--fs-text-dim)" }}>{specString(`controls.tour.${id}.body`)}</p>
      <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" data-testid="controls-tour-skip" onClick={() => press("skip")} {...btn("skip")}>
          {specString("controls.tour.skip")}
        </button>
        <button type="button" data-testid="controls-tour-next" onClick={() => press("next")} {...btn("next")}>
          {specString(last ? "controls.tour.done" : "controls.tour.next")}
        </button>
      </div>
    </section>
  );
}
