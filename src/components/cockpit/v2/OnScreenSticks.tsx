"use client";

/**
 * @module cockpit/v2/OnScreenSticks
 * @description Optional thumb sticks for flying the pilot without a
 * controller (Settings › Controls › On-screen sticks, default off). Two
 * 120 px pads sit at the bottom corners in the spec's width classes. They
 * follow the operator's controller settings: the stick mode (Mode 2: left
 * pad throttle and yaw, right pad forward and right; Mode 1: left pad
 * forward and yaw, right pad throttle and right) and the radial deadzone,
 * drawn as a ring on each pad. They send the same pilot `input` frames as a
 * gamepad at 50 Hz while touched, and `release` when let go (a lost pointer
 * capture included), when the pads leave the screen mid-touch, or when the
 * tab is hidden. While shown they stand in for a controller in the
 * pre-flight checklist (`on-screen-sticks-shown`).
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import {
  PILOT_INPUT_PERIOD_MS,
  sendPilotInput,
  sendPilotRelease,
  sticksRouteToPilot,
  usePilotLinkStore,
} from "@/lib/input/pilot-stream";
import { specString } from "@/lib/cockpit/spec-strings";
import { radialDeadzone } from "@/lib/input/gamepad-axes";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";
import { useInputStore, type TxMode } from "@/stores/input-store";
import { useOnScreenSticksShown } from "@/lib/cockpit/on-screen-sticks-shown";

const SPEC = layoutSpec.on_screen_sticks;
const PAD = SPEC.pad_size;
/** The width classes the pads show in (`layout.json` `on_screen_sticks.classes`). */
export const STICK_CLASSES: readonly string[] = SPEC.classes;

type Vec = [number, number];

/**
 * Pad pointer offset → stick vector in [-1, 1] (y up positive), clamped to
 * the pad's circle and conditioned with the radial deadzone `dz`.
 */
export function padVector(dx: number, dy: number, radius: number, dz: number): Vec {
  let x = dx / radius;
  let y = -dy / radius;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return radialDeadzone(x, y, dz);
}

/**
 * The pilot axes `[roll, pitch, thr, yaw]` for the two pads in a stick mode
 * (Mode 2: left pad yaw and throttle, right pad roll and pitch; Mode 1: left
 * pad yaw and pitch, right pad roll and throttle; a released pad is
 * centred). Signs as the pilot expects: pitch + forward, thr + climb, yaw +
 * clockwise, roll + right.
 */
export function onScreenAxes(left: Vec | null, right: Vec | null, mode: TxMode): [number, number, number, number] {
  const [yaw, leftY] = left ?? [0, 0];
  const [roll, rightY] = right ?? [0, 0];
  return mode === 1 ? [roll, leftY, rightY, yaw] : [roll, rightY, leftY, yaw];
}

type Side = "left" | "right";

function Pad({
  side,
  mode,
  deadzone,
  onMove,
}: {
  side: Side;
  mode: TxMode;
  deadzone: number;
  onMove: (side: Side, v: Vec | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<Vec>([0, 0]);
  // A pad leaving mid-touch (a controller connected) gets no pointer events
  // any more: its stick goes neutral as it unmounts.
  useEffect(() => () => onMove(side, null), [onMove, side]);
  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = padVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, deadzone);
    setKnob(v);
    onMove(side, v);
  };
  const end = () => {
    setKnob([0, 0]);
    onMove(side, null);
  };
  const ring = deadzone * PAD;
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={specString(`cockpit.sticks.${side}_aria${mode === 1 ? "_mode1" : ""}`)}
      aria-valuenow={Math.round(knob[1] * 100)}
      data-testid={`on-screen-stick-${side}`}
      className="relative touch-none select-none rounded-full border border-white/30 bg-black/35 backdrop-blur-sm"
      style={{ width: PAD, height: PAD }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 0 || e.pointerType === "touch") update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span
        data-testid={`on-screen-stick-${side}-knob`}
        className="absolute h-12 w-12 rounded-full bg-white/70 shadow"
        style={{
          zIndex: 1,
          left: PAD / 2 - 24 + knob[0] * (PAD / 2 - 24),
          top: PAD / 2 - 24 - knob[1] * (PAD / 2 - 24),
        }}
      />
      {/* Above the knob, dark on light with a light halo, so the deadzone
          shows over the centred knob and over the dark pad alike. */}
      <span
        aria-hidden="true"
        data-testid={`on-screen-stick-${side}-deadzone`}
        className="pointer-events-none absolute rounded-full border border-dashed border-black/70 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
        style={{ zIndex: 2, width: ring, height: ring, left: (PAD - ring) / 2, top: (PAD - ring) / 2 }}
      />
    </div>
  );
}

export function OnScreenSticks({ droneId }: { droneId: string }) {
  const enabled = useCockpitPrefsStore((s) => s.onScreenSticks);
  const widthClass = useCockpitWidthClass();
  const routed = usePilotLinkStore((s) => s.connected && s.controlMode === "ados");
  const padConnected = usePadStatusStore((s) => s.connected);
  const deadzone = useInputStore((s) => s.deadzone);
  const mode = useInputStore((s) => s.txMode);
  const axes = useRef<Record<Side, Vec | null>>({ left: null, right: null });
  const [active, setActive] = useState(false);

  // While a pad is held: 50 Hz frames in the operator's stick mode; on lift
  // or a hidden tab: release.
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || !sticksRouteToPilot(droneId)) {
        sendPilotRelease();
        return;
      }
      sendPilotInput(onScreenAxes(axes.current.left, axes.current.right, useInputStore.getState().txMode), 0);
    }, PILOT_INPUT_PERIOD_MS);
    return () => {
      clearInterval(tick);
      sendPilotRelease();
    };
  }, [active, droneId]);

  // Stable, so a pad's unmount cleanup always reaches the live axes.
  const move = useCallback((side: Side, v: Vec | null) => {
    axes.current[side] = v;
    setActive(axes.current.left !== null || axes.current.right !== null);
  }, []);

  const show = enabled && routed && !padConnected && STICK_CLASSES.includes(widthClass);
  useEffect(() => {
    useOnScreenSticksShown.getState().setShown(show);
    return () => useOnScreenSticksShown.getState().setShown(false);
  }, [show]);
  if (!show) return null;
  return (
    <>
      <div className="pointer-events-auto absolute bottom-6 left-6 z-30">
        <Pad side="left" mode={mode} deadzone={deadzone} onMove={move} />
      </div>
      <div className="pointer-events-auto absolute bottom-6 right-6 z-30">
        <Pad side="right" mode={mode} deadzone={deadzone} onMove={move} />
      </div>
    </>
  );
}
