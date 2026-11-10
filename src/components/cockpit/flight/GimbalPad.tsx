"use client";

/**
 * @module cockpit/flight/GimbalPad
 * @description The right column's gimbal pad: a round drag-to-rate pad.
 *
 * - Drag: the offset from the pad's centre sets the pitch and yaw rate (a
 *   small dead zone round the centre, then a curve up to the full rate at
 *   the rim); letting go sends a zero rate.
 * - Keyboard, while the pad has focus: the arrow keys hold a fixed rate,
 *   Enter recentres the gimbal. Space is never handled here: it stays the
 *   Pause hotkey.
 * - The centre knob recentres the gimbal through the camera extension when
 *   it is tapped; a drag that starts on it aims like any other drag. The
 *   knob is not a tab stop and ignores keyboard clicks, so Space on it does
 *   nothing (Enter on the pad recentres).
 *
 * Rates go through the gimbal rate driver (`@/lib/cockpit/gimbal-rate`): at
 * most one change per 100 ms, one request in flight, the latest rate wins,
 * backoff after a 429.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crosshair } from "lucide-react";

import { notifySkill } from "@/lib/skills/registry";
import { firePluginSkill } from "@/hooks/use-ds4-dispatcher";
import { specString } from "@/lib/cockpit/spec-strings";
import { EXTENSION_RECENTRE_IDS } from "@/lib/cockpit/camera-actions";
import { GimbalRateDriver, gimbalRateAvailable } from "@/lib/cockpit/gimbal-rate";
import layoutSpec from "@/lib/cockpit-spec/layout.json";

/** Rate at the pad's rim (°/s). */
export const GIMBAL_PAD_MAX_DPS = 60;
/** Rate an arrow key holds while the pad has focus (°/s). */
export const GIMBAL_PAD_KEY_DPS = 30;
/** The pad's diameter, unscaled. */
export const GIMBAL_PAD_PX = 108;
/** Share of the radius round the centre that reads as no rate. */
const DEAD_ZONE = 0.15;
/** How often the pad re-asks whether the drone takes gimbal rates. */
const AVAILABILITY_POLL_MS = 5000;

const ARROWS: Record<string, { p: number; y: number }> = {
  ArrowUp: { p: 1, y: 0 },
  ArrowDown: { p: -1, y: 0 },
  ArrowLeft: { p: 0, y: -1 },
  ArrowRight: { p: 0, y: 1 },
};

/** Whether the drone's agent takes gimbal rates, re-checked while mounted. */
export function useGimbalRateAvailable(droneId: string): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () =>
      void gimbalRateAvailable(droneId).then((a) => {
        if (live) setAvailable(a);
      });
    check();
    const id = setInterval(check, AVAILABILITY_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [droneId]);
  return available;
}

/** One axis of a drag (-1..1 of the radius) as a share of the full rate. */
function shape(v: number): number {
  const a = Math.min(1, Math.abs(v));
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * ((a - DEAD_ZONE) / (1 - DEAD_ZONE)) ** 1.5;
}

/** Pitch (+ up) and yaw (+ right) rate for a pointer offset from the
 * centre, in pad radii (screen y grows down). */
export function padRate(dx: number, dy: number): { pitch: number; yaw: number } {
  return { pitch: -shape(dy) * GIMBAL_PAD_MAX_DPS || 0, yaw: shape(dx) * GIMBAL_PAD_MAX_DPS || 0 };
}

/** Recentre the gimbal through the camera extension. */
function recentre(droneId: string): void {
  if (!firePluginSkill(droneId, EXTENSION_RECENTRE_IDS)) notifySkill(specString("cockpit.camera.no_extension"), "warning");
}

export function GimbalPad({ droneId, scale = 1 }: { droneId: string; scale?: number }) {
  const driver = useRef<GimbalRateDriver | null>(null);
  const origin = useRef<{ x: number; y: number; r: number; captured: boolean } | null>(null);
  /** This press moved the gimbal: the release is not a tap on the knob. */
  const dragged = useRef(false);
  const held = useRef(new Set<string>());
  const [rate, setRate] = useState({ pitch: 0, yaw: 0 });

  useEffect(() => {
    const d = new GimbalRateDriver(droneId, GIMBAL_PAD_MAX_DPS);
    driver.current = d;
    return () => {
      d.stop();
      driver.current = null;
    };
  }, [droneId]);

  const send = (pitch: number, yaw: number) => {
    setRate({ pitch, yaw });
    driver.current?.set(pitch, yaw);
  };
  const release = () => {
    origin.current = null;
    held.current.clear();
    send(0, 0);
  };
  const sendKeys = () => {
    let p = 0;
    let y = 0;
    for (const k of held.current) {
      p += ARROWS[k].p;
      y += ARROWS[k].y;
    }
    send(p * GIMBAL_PAD_KEY_DPS, y * GIMBAL_PAD_KEY_DPS);
  };
  const dragTo = (clientX: number, clientY: number, el: Element, pointerId: number) => {
    const o = origin.current;
    if (!o || o.r <= 0) return;
    const r = padRate((clientX - o.x) / o.r, (clientY - o.y) / o.r);
    if (r.pitch !== 0 || r.yaw !== 0) {
      dragged.current = true;
      // Capture on the first move past the dead zone, so a drag that began
      // on the knob keeps reaching the pad.
      if (!o.captured) {
        o.captured = true;
        el.setPointerCapture?.(pointerId);
      }
    }
    send(r.pitch, r.yaw);
  };

  const size = GIMBAL_PAD_PX * scale;
  const knob = layoutSpec.touch_target.min * scale;
  const travel = (size - knob) / 2;
  const kx = (rate.yaw / GIMBAL_PAD_MAX_DPS) * travel;
  const ky = (-rate.pitch / GIMBAL_PAD_MAX_DPS) * travel;

  return (
    <div
      className="fs-gimbal-pad"
      role="group"
      tabIndex={0}
      aria-label={specString("cockpit.gimbal_pad")}
      aria-description={specString("cockpit.gimbal_pad.hint")}
      title={specString("cockpit.gimbal_pad.hint")}
      data-testid="fs-gimbal_pad"
      data-item="gimbal_pad"
      data-pitch-dps={rate.pitch}
      data-yaw-dps={rate.yaw}
      style={{ width: size, height: size, touchAction: "none" }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        // A press on the knob is not captured yet: capture retargets the
        // click to the pad and a tap on the knob would never recentre. Any
        // other press captures at once, so the release always reaches the pad.
        const onKnob = (e.target as Element).closest("button") !== null;
        if (!onKnob) e.currentTarget.setPointerCapture?.(e.pointerId);
        dragged.current = false;
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, captured: !onKnob };
        dragTo(e.clientX, e.clientY, e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!origin.current) return;
        // No button down: the release happened elsewhere, so the drag is over.
        if (e.pointerType === "mouse" && e.buttons === 0) {
          release();
          return;
        }
        dragTo(e.clientX, e.clientY, e.currentTarget, e.pointerId);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        if (origin.current) release();
      }}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key in ARROWS) {
          e.preventDefault();
          e.stopPropagation();
          if (held.current.has(e.key)) return;
          held.current.add(e.key);
          sendKeys();
        } else if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) recentre(droneId);
        }
      }}
      onKeyUp={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!(e.key in ARROWS)) return;
        e.preventDefault();
        e.stopPropagation();
        held.current.delete(e.key);
        sendKeys();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && (held.current.size > 0 || origin.current)) release();
      }}
    >
      {[0, 90, 180, 270].map((deg) => (
        <span
          key={deg}
          className="fs-gimbal-tick"
          aria-hidden="true"
          style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(${-(size / 2 - 10)}px)` }}
        />
      ))}
      <button
        type="button"
        tabIndex={-1}
        className="fs-gimbal-knob"
        data-testid="fs-gimbal-recentre"
        aria-label={specString("cockpit.gimbal.recentre")}
        title={specString("cockpit.gimbal.recentre")}
        style={{ width: knob, height: knob, transform: `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))` }}
        onClick={(e) => {
          // A keyboard click (Space or Enter on a focused knob) is not a tap.
          if (e.detail === 0) return;
          // The press was a drag that ended on the knob: no recentre.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          recentre(droneId);
        }}
      >
        <Crosshair className="fs-ico-sm" aria-hidden="true" />
      </button>
    </div>
  );
}
