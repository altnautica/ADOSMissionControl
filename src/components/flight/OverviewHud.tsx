"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDroneStore } from "@/stores/drone-store";
import { readHudFrame } from "@/lib/hud-readings";
import { batteryBand } from "@/lib/battery-bands";
import { useSettingsStore } from "@/stores/settings-store";
import { drawSkyGround, drawPitchLadder, drawRollArc, drawCrosshair } from "@/lib/hud-draw-attitude";
import { drawSpeedTape, drawAltTape, drawHeadingCompass } from "@/lib/hud-draw-nav";
import {
  drawBatteryHud,
  drawGpsAndMode,
  drawArmedStatus,
  drawSignalBars,
  drawFlightTimer,
} from "@/lib/hud-draw-status";
import { useToast } from "@/components/ui/toast";
import { popupRefusedMessage } from "@/components/flight/telemetry-deck/deck-utils";

/**
 * Artificial horizon HUD with sky/ground gradient background.
 * Used on the Overview tab — full glass cockpit experience.
 */
export function OverviewHud() {
  const { toast } = useToast();
  // The canvas moves between documents when the HUD detaches (React mounts a
  // new one inside the popup), so it is held in state and every effect that
  // measures or draws re-binds to whichever canvas is mounted now.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);

  const reattach = useCallback(() => {
    setIsDetached(false);
    setPopupContainer(null);

    const popup = popupRef.current;
    if (popup && !popup.closed) popup.close();
    popupRef.current = null;
  }, []);

  const detach = useCallback(() => {
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }

    const popup = window.open(
      "",
      "overview-hud-detached",
      "width=980,height=640,resizable=yes,scrollbars=no"
    );
    if (!popup) {
      toast(popupRefusedMessage("HUD"), "warning");
      return;
    }

    popup.document.title = "HUD";
    popup.document.body.innerHTML = "";
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#0a1428";
    popup.document.body.style.overflow = "hidden";

    // Mirror stylesheets so utility classes render in the detached window.
    const styleNodes = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"));
    for (const node of styleNodes) {
      popup.document.head.appendChild(node.cloneNode(true));
    }

    const container = popup.document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    popup.document.body.appendChild(container);

    popup.addEventListener("beforeunload", () => {
      setIsDetached(false);
      setPopupContainer(null);
      popupRef.current = null;
    });

    popupRef.current = popup;
    setPopupContainer(container);
    setIsDetached(true);
    popup.focus();
  }, [toast]);

  const handleToggleDetach = useCallback(() => {
    if (isDetached) {
      reattach();
      return;
    }
    detach();
  }, [detach, isDetached, reattach]);

  useEffect(() => {
    if (!canvas) return;
    const parent = canvas.parentElement;
    // Drive the loop from the window that owns the canvas: a detached popup
    // keeps animating when the main window is backgrounded or minimized, and
    // the freshness gating in readHudFrame keeps running there.
    const view = canvas.ownerDocument.defaultView ?? window;
    const ctx = canvas.getContext("2d");
    if (!parent || !ctx) return;

    // Measured on resize rather than read inside the loop: getBoundingClientRect
    // forces a synchronous layout flush, and this loop runs at display rate for
    // a value that only changes when the pane resizes.
    const size = { width: 0, height: 0 };
    const measure = () => {
      const box = parent.getBoundingClientRect();
      size.width = box.width;
      size.height = box.height;
    };
    measure();
    const ro = new view.ResizeObserver(measure);
    ro.observe(parent);

    let raf = 0;
    const draw = () => {
      raf = view.requestAnimationFrame(draw);
      if (size.width <= 0 || size.height <= 0) return;
      const dpr = view.devicePixelRatio || 1;
      const pxW = Math.floor(size.width * dpr);
      const pxH = Math.floor(size.height * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = size.width;
      const h = size.height;
      const cx = w / 2;
      const cy = h / 2;

      // Every reading is freshness-gated in one place and every one of them is
      // nullable, so an absent sample draws an explicit unknown rather than a
      // fabricated value: no level horizon and no four-bar signal meter on a
      // vehicle nobody is hearing from. The flight timer counts from the arm
      // transition only while a fresh heartbeat says the vehicle is armed.
      const hud = readHudFrame();
      const armedAt = hud.armed === true ? useDroneStore.getState().armedAt : null;

      // Sky/ground gradient FIRST (background)
      drawSkyGround(ctx, w, h, hud.pitch, hud.roll);

      // Instruments on top
      drawPitchLadder(ctx, cx, cy, hud.pitch, hud.roll, h);
      drawRollArc(ctx, cx, cy, hud.roll, h);
      drawCrosshair(ctx, cx, cy);
      drawSpeedTape(ctx, cx - w * 0.25, cy, hud.speedKph, h);
      drawAltTape(ctx, cx + w * 0.25, cy, hud.alt, h);
      drawHeadingCompass(ctx, cx, 30, hud.heading, w);
      const { batteryWarningPct, batteryCriticalPct } = useSettingsStore.getState();
      drawBatteryHud(
        ctx,
        cx,
        h - 45,
        hud.batteryPct,
        batteryBand(hud.batteryPct, {
          warningPct: batteryWarningPct,
          criticalPct: batteryCriticalPct,
        }),
      );
      drawGpsAndMode(ctx, 16, h - 20, hud.satellites, hud.mode);
      drawArmedStatus(ctx, cx, cy + 34, hud.armed);
      drawSignalBars(ctx, w - 80, h - 20, hud.signalBars);
      drawFlightTimer(ctx, w - 16, h - 20, armedAt);
    };
    raf = view.requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      view.cancelAnimationFrame(raf);
    };
  }, [canvas]);

  // Close a still-open popup when the HUD unmounts.
  useEffect(
    () => () => {
      const popup = popupRef.current;
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
    },
    [],
  );

  const hudContent = useMemo(() => (
    <div
      className="relative w-full h-full border border-border-default overflow-hidden bg-bg-secondary"
      onDoubleClick={handleToggleDetach}
      title={isDetached ? "Double-click to reattach" : "Double-click to detach into a new window"}
    >
      <span className="absolute top-2 left-2 z-10 text-[9px] font-mono text-text-tertiary">
        Attitude
      </span>
      <span className="absolute top-2 right-2 z-10 text-[9px] font-mono text-text-tertiary">
        {isDetached ? "Detached" : "Double-click to detach"}
      </span>
      <canvas ref={setCanvas} className="absolute inset-0 w-full h-full" />
    </div>
  ), [handleToggleDetach, isDetached]);

  if (isDetached && popupContainer) {
    return (
      <>
        <div className="relative w-full h-full border border-border-default overflow-hidden bg-bg-secondary">
          <div className="absolute inset-0 flex items-center justify-center text-xs text-text-tertiary font-mono">
            HUD detached to separate window. Double-click HUD there or close that window to reattach.
          </div>
        </div>
        {createPortal(hudContent, popupContainer)}
      </>
    );
  }

  return hudContent;
}
