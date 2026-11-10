"use client";

/**
 * @module cockpit/v2/OnScreenSticks
 * @description Optional thumb sticks for flying the pilot without a
 * controller (Settings › Controls › On-screen sticks, default off). Two
 * 120 px pads sit at the bottom corners in the spec's width classes; Mode 2:
 * left pad throttle (up climbs, centre holds) and yaw, right pad forward and
 * right. They send the same pilot `input` frames as a gamepad at 50 Hz while
 * touched, and `release` when let go or when the tab is hidden.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import {
  PILOT_INPUT_PERIOD_MS,
  sendPilotInput,
  sendPilotRelease,
  sticksRouteToPilot,
  usePilotLinkStore,
} from "@/lib/input/pilot-stream";
import { radialDeadzone } from "@/lib/input/gamepad-axes";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";

const SPEC = layoutSpec.on_screen_sticks;
const PAD = SPEC.pad_size;
const DEADZONE = 0.08;

type Vec = [number, number];

/** Pad pointer offset → stick vector in [-1, 1] (y up positive). */
export function padVector(dx: number, dy: number, radius: number): Vec {
  let x = dx / radius;
  let y = -dy / radius;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return radialDeadzone(x, y, DEADZONE);
}

function Pad({ side, onMove }: { side: "left" | "right"; onMove: (v: Vec | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<Vec>([0, 0]);
  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = padVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2);
    setKnob(v);
    onMove(v);
  };
  const end = () => {
    setKnob([0, 0]);
    onMove(null);
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={side === "left" ? "Throttle and yaw" : "Forward and sideways"}
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
        className="absolute h-12 w-12 rounded-full bg-white/70 shadow"
        style={{
          left: PAD / 2 - 24 + knob[0] * (PAD / 2 - 24),
          top: PAD / 2 - 24 - knob[1] * (PAD / 2 - 24),
        }}
      />
    </div>
  );
}

export function OnScreenSticks({ droneId }: { droneId: string }) {
  const enabled = useCockpitPrefsStore((s) => s.onScreenSticks);
  const widthClass = useCockpitWidthClass();
  const routed = usePilotLinkStore((s) => s.connected && s.controlMode === "ados");
  const padConnected = usePadStatusStore((s) => s.connected);
  const axes = useRef<{ left: Vec | null; right: Vec | null }>({ left: null, right: null });
  const [active, setActive] = useState(false);

  // While a pad is held: 50 Hz frames; on lift or a hidden tab: release.
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || !sticksRouteToPilot(droneId)) {
        sendPilotRelease();
        return;
      }
      const [yaw, thr] = axes.current.left ?? [0, 0];
      const [roll, pitch] = axes.current.right ?? [0, 0];
      sendPilotInput([roll, pitch, thr, yaw], 0);
    }, PILOT_INPUT_PERIOD_MS);
    return () => {
      clearInterval(tick);
      sendPilotRelease();
    };
  }, [active, droneId]);

  const show = enabled && routed && !padConnected && (SPEC.classes as string[]).includes(widthClass);
  if (!show) return null;
  const move = (side: "left" | "right") => (v: Vec | null) => {
    axes.current[side] = v;
    setActive(axes.current.left !== null || axes.current.right !== null);
  };
  return (
    <>
      <div className="pointer-events-auto absolute bottom-6 left-6 z-30">
        <Pad side="left" onMove={move("left")} />
      </div>
      <div className="pointer-events-auto absolute bottom-6 right-6 z-30">
        <Pad side="right" onMove={move("right")} />
      </div>
    </>
  );
}
