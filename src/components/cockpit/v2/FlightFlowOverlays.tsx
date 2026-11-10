"use client";

/**
 * @module cockpit/v2/FlightFlowOverlays
 * @description The flight-flow chrome the drone's pilot drives:
 *
 *   - the handover banner (`pilot.banner`), full width for 3 s;
 *   - the "Centre sticks to take control" ring while the handover gate is
 *     pending (`pilot.gate`);
 *   - "Sticks are with <surface>" with a Take over hold when another
 *     surface owns the stick session (`pilot.input_session`);
 *   - the low-battery return-home countdown with Cancel
 *     (`pilot.rth_countdown_s`) and the link-loss countdown
 *     (`pilot.link_loss_in_s`);
 *   - voice prompts for handovers, return home, low battery and mission
 *     state changes (Web Speech; Settings › Sound, default on).
 *
 * They stack in one top-centre column under the follow strip (or the top
 * bar), between the side columns (`flowColumn`): countdowns first, then the
 * handover banner, the sticks-with take over and the centre-sticks ring. The
 * screen centre stays the clean camera view (`layout.json` center `clean`),
 * so the ring never sits on it. A PICTURE FROZEN banner, when up, keeps the
 * column's first slot.
 *
 * Text comes from the shared cockpit strings, so every surface says the
 * same thing.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { FROZEN_BANNER_H, useVideoFrozen } from "@/components/cockpit/CockpitVideoStatusBanner";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { flowColumn } from "@/components/cockpit/flight/flight-grid";
import tokens from "@/lib/cockpit-spec/tokens.json";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { linkLossLine } from "@/lib/hud/link-loss";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { hasSpecString, specString } from "@/lib/cockpit/spec-strings";
import { PILOT_SRC, sendPilotAction, takePilotSession, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";

const HANDOVER_MS = layoutSpec.banners.handover_ms;
const TAKE_CONTROL_HOLD_MS = layoutSpec.holds_ms.take_control;
/** Space between the stacked overlays. */
const STACK_GAP_PX = 8;

/** The banner's args with the spec's sub-keys resolved (`source: "rc"` →
 * "RC switch") and the profile in the chip's upper case. */
export function bannerText(banner: NonNullable<PilotState["banner"]>): string {
  const args: Record<string, unknown> = { ...banner.args };
  const src = args.source;
  if (typeof src === "string" && hasSpecString(`pilot.banner.source.${src}`)) {
    args.source = specString(`pilot.banner.source.${src}`);
  }
  if (typeof args.profile === "string") args.profile = args.profile.toUpperCase();
  return specString(banner.textKey, args);
}

/** The voice line for a change of pilot state, or null. Exported for tests. */
export function voiceLine(
  prev: { owner: string | null; fcModeName: string | null; mission: string | null; rth: boolean },
  next: { owner: string | null; fcModeName: string | null; mission: string | null; rth: boolean },
): string | null {
  if (!prev.rth && next.rth) return specString("voice.low_battery");
  if (prev.mission !== next.mission) {
    if (next.mission === "active") return specString("voice.mission_active");
    if (next.mission === "paused") return specString("voice.mission_paused");
    if (next.mission === "complete") return specString("voice.mission_complete");
  }
  if (prev.owner === next.owner && prev.fcModeName === next.fcModeName) return null;
  if (next.owner === "fc_mode" && next.fcModeName && /RTL|RETURN/i.test(next.fcModeName)) {
    return specString("voice.rth");
  }
  if (next.owner === "pilot" && prev.owner !== "pilot") return specString("voice.ados_control");
  if (next.owner === "fc_mode" && prev.owner !== null && prev.owner !== "fc_mode") {
    return specString("voice.fc_control");
  }
  return null;
}

function speak(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en";
  window.speechSynthesis.speak(u);
}

function useVoicePrompts(droneId: string, pilot: PilotState | null): void {
  const enabled = useCockpitPrefsStore((s) => s.voicePrompts);
  const mission = useMissionStatus(droneId)?.state ?? null;
  const prev = useRef<{ owner: string | null; fcModeName: string | null; mission: string | null; rth: boolean } | null>(null);
  const owner = pilot?.owner ?? null;
  const fcModeName = pilot?.fcModeName ?? null;
  const rth = pilot?.rthCountdownS != null;
  useEffect(() => {
    const next = { owner, fcModeName, mission, rth };
    const before = prev.current;
    prev.current = next;
    if (!enabled || !before) return;
    const line = voiceLine(before, next);
    if (line) speak(line);
  }, [enabled, owner, fcModeName, mission, rth]);
}

function HandoverBanner({ pilot }: { pilot: PilotState | null }) {
  const banner = pilot?.banner ?? null;
  const text = banner ? bannerText(banner) : null;
  // Shown for the spec's handover time from when its text first appears.
  const [lastText, setLastText] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  if (text && text !== lastText) {
    setLastText(text);
    setVisible(true);
  }
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), HANDOVER_MS);
    return () => clearTimeout(t);
  }, [visible, lastText]);
  if (!visible || !lastText) return null;
  return (
    <div role="status" aria-live="polite" data-testid="handover-banner" className="pointer-events-none flex w-full justify-center">
      <span className="glass-panel w-[min(640px,100%)] px-4 py-2 text-center text-sm font-semibold text-text-primary">
        {lastText}
      </span>
    </div>
  );
}

function GateRing({ gate }: { gate: PilotState["gate"] }) {
  if (!gate?.pending) return null;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div role="status" data-testid="gate-ring" className="pointer-events-none flex flex-col items-center gap-2">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.25)" strokeWidth="6" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={tokens.state.pilot}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - gate.progress)}
          transform="rotate(-90 42 42)"
        />
      </svg>
      <span className="glass-pill px-3 py-1 text-xs font-semibold text-text-primary">
        {specString("flow.gate.centre_sticks")}
      </span>
    </div>
  );
}

function SticksWith({ pilot }: { pilot: PilotState | null }) {
  const padConnected = usePadStatusStore((s) => s.connected);
  const streaming = usePilotLinkStore((s) => s.streaming);
  const session = pilot?.inputSession ?? null;
  if (!session || session.src === PILOT_SRC || (!padConnected && !streaming)) return null;
  return (
    <div
      role="status"
      data-testid="sticks-with"
      className="glass-panel pointer-events-auto flex max-w-full items-center gap-3 px-3 py-1 text-xs text-text-primary"
    >
      <span>{specString("flow.sticks_with", { label: session.label })}</span>
      <HoldButton
        holdMs={TAKE_CONTROL_HOLD_MS}
        onFire={() => void takePilotSession()}
        className="min-h-12 rounded bg-accent-primary/25 px-3 font-semibold text-accent-primary"
      >
        {specString("flow.sticks_take_over")}
      </HoldButton>
    </div>
  );
}

function Countdowns({ pilot }: { pilot: PilotState | null }) {
  const rth = pilot?.rthCountdownS ?? null;
  const linkLoss = pilot?.linkLossInS ?? null;
  if (rth === null && linkLoss === null) return null;
  return (
    <div className="pointer-events-none flex w-full flex-col items-center gap-2">
      {rth !== null && (
        <div
          role="alert"
          data-testid="low-battery-rth"
          className="pointer-events-auto flex w-[min(720px,100%)] items-center justify-between gap-3 rounded-lg bg-status-error/90 px-4 py-2 text-sm font-semibold text-white"
        >
          <span className="flex flex-col">
            <span>{specString("flow.low_battery.title", { in_s: Math.ceil(rth) })}</span>
            <span data-testid="low-battery-cancel-warning" className="text-xs font-normal">
              {specString("flow.low_battery.cancel_warning")}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void sendPilotAction("rth_cancel")}
            className="min-h-12 rounded bg-black/80 px-4 text-white"
          >
            {specString("flow.low_battery.cancel")}
          </button>
        </div>
      )}
      {linkLoss !== null && (
        <div role="alert" data-testid="link-loss-countdown" className="rounded-lg bg-status-error/90 px-4 py-2 text-sm font-semibold text-white">
          {linkLossLine({ linkLossInS: linkLoss, linkLossAction: pilot?.linkLossAction ?? null })}
        </div>
      )}
    </div>
  );
}

export function FlightFlowOverlays({ droneId, pilot }: { droneId: string; pilot: PilotState | null }) {
  useVoicePrompts(droneId, pilot);
  const grid = useFlightGrid();
  const frozen = useVideoFrozen(droneId) !== null;
  const col = flowColumn(grid);
  const top = col.y + (frozen ? FROZEN_BANNER_H + STACK_GAP_PX : 0);
  return (
    <div
      data-testid="flow-stack"
      className="pointer-events-none absolute z-[45] flex flex-col items-center"
      style={{ left: col.x, top, width: col.w, gap: STACK_GAP_PX }}
    >
      <Countdowns pilot={pilot} />
      <HandoverBanner pilot={pilot} />
      <SticksWith pilot={pilot} />
      <GateRing gate={pilot?.gate ?? null} />
    </div>
  );
}
