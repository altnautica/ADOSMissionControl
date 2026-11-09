/**
 * @module use-ds4-dispatcher
 * @description The cockpit's controller actions, from the binding table in
 * force (Settings › Controls, else the spec's `ds4.json`): PS pause and the
 * 2 s RTH hold, the L1 + R1 arm hold, the L2 + R2 + Circle kill hold, the
 * D-pad skill-picker focus and parameter steps (layer level with the picker
 * closed), Cross GO, Circle Stop, Triangle view / take-off / land, Options
 * quick settings and the profile steps, plus rumble on each action and the
 * lightbar following the flight state.
 *
 * Built-in flight actions go through the shared skill pipeline, so their
 * gates still apply; a controller hold confirms a hold-tier action by itself
 * (the emergency stop still asks).
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import { usePickerStore, sendPickerCommand, type PickerCommand } from "@/lib/cockpit/picker-commands";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import {
  CENTERED_THRESHOLD,
  DS4_ACTIONS,
  GestureEngine,
  WEB_BUTTON_INDEX,
  type Ds4Binding,
} from "@/lib/input/ds4-bindings";
import { lightbarColour, lightbarState, rumble, rumbleHoldTick, setLightbar } from "@/lib/input/ds4-feedback";
import { sendPilotAction } from "@/lib/input/pilot-stream";
import { GimbalRateDriver } from "@/lib/cockpit/gimbal-rate";
import { reticleControl, toggleReticle } from "@/lib/cockpit/designate-reticle";
import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { useCockpitLayersStore } from "@/stores/cockpit-layers-store";
import { effectiveBindings, useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useInputStore } from "@/stores/input-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { startRecording, stopRecording, captureScreenshot } from "@/lib/video/webrtc-client";
import { useVideoStore } from "@/stores/video-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useViewZoomStore } from "@/components/cockpit/flight/view-zoom-store";

/** Engine tick for hold timing between button changes. */
const TICK_MS = 50;
const PROFILES = ["cine", "normal", "sport"] as const;
const LOCKED: Record<string, true> = { pause: true, rth: true, rth_cancel: true, arm: true, kill: true };

/** Fire the first installed extension skill whose local id is in `ids`;
 * false when none is installed. */
export function firePluginSkill(droneId: string, ids: readonly string[]): boolean {
  for (const s of useSkillRegistry.getState().skills.values()) {
    if (s.source !== "plugin") continue;
    const local = s.id.slice(s.id.indexOf(":") + 1);
    if (ids.includes(local)) {
      void activate(s.id, buildSkillContext(droneId));
      return true;
    }
  }
  return false;
}

function runAction(droneId: string, b: Ds4Binding): void {
  const pilot = useNavStreamStore.getState().byDrone[droneId]?.pilot?.data ?? null;
  const builtin = DS4_ACTIONS.find((a) => a.id === b.action)?.builtin;
  if (builtin) {
    void activate(builtin, buildSkillContext(droneId), b.gesture === "hold" ? { confirmedByHold: true } : undefined);
    return;
  }
  if (b.action.startsWith("skill:")) {
    const [, plugin, skill] = b.action.split(":");
    void activate(`${plugin}:${skill}`, buildSkillContext(droneId));
    return;
  }
  const picker = (cmd: PickerCommand) => void sendPickerCommand(cmd);
  const layers = useCockpitLayersStore.getState();
  switch (b.action) {
    case "rth_cancel":
      sendPilotAction("rth_cancel");
      break;
    case "picker_focus_prev":
      picker("focus_prev");
      break;
    case "picker_focus_next":
      picker("focus_next");
      break;
    case "skill_select":
      picker("select");
      break;
    case "skill_stop":
      picker("stop");
      break;
    case "param_up":
      picker("param_up");
      break;
    case "param_down":
      picker("param_down");
      break;
    case "layer_level_up":
    case "layer_level_down": {
      layers.stepLevel(droneId, b.action === "layer_level_up" ? -1 : 1);
      break;
    }
    case "view_next":
      useCockpitViewStore.getState().cycleView(droneId);
      break;
    case "swap_video_map": {
      const views = useCockpitViewStore.getState();
      const cur = views.byDrone[droneId] ?? "pilot";
      views.setView(droneId, cur === "map" ? "pilot" : "map");
      break;
    }
    case "quick_settings":
      useFlyQuickSettingsStore.getState().toggle();
      break;
    case "profile_prev":
    case "profile_next": {
      const at = PROFILES.indexOf(pilot?.profile ?? "normal");
      const step = b.action === "profile_next" ? 1 : -1;
      sendPilotAction(`profile:${PROFILES[(at + step + PROFILES.length) % PROFILES.length]}`);
      break;
    }
    case "vtol_transition":
      sendPilotAction(pilot?.vehicleClass === "vtol" && /^Q/i.test(pilot.fcModeName ?? "") ? "vtol:fw" : "vtol:mc");
      break;
    case "photo":
      if (!firePluginSkill(droneId, ["capture", "photo", "take-photo"])) void captureScreenshot();
      break;
    case "record_toggle":
      if (!firePluginSkill(droneId, ["record", "record-toggle"])) {
        if (useVideoStore.getState().isRecording) stopRecording();
        else startRecording();
      }
      break;
    case "zoom_in":
      if (!firePluginSkill(droneId, ["zoom-in"])) useViewZoomStore.getState().step(droneId, 1);
      break;
    case "zoom_out":
      if (!firePluginSkill(droneId, ["zoom-out"])) useViewZoomStore.getState().step(droneId, -1);
      break;
    case "gimbal_recenter":
      firePluginSkill(droneId, ["center", "recenter", "gimbal-recenter"]);
      break;
    case "designate":
      toggleReticle();
      break;
  }
}

export function useDs4Dispatcher(droneId: string): void {
  const bindings = useControlsStore((s) => s.bindings);

  useEffect(() => {
    const when = (cond: string): boolean => {
      const pilot = useNavStreamStore.getState().byDrone[droneId]?.pilot?.data ?? null;
      const rth = !!pilot?.fcModeName && /RTL|QRTL/i.test(pilot.fcModeName);
      const onGround = pilot ? pilot.landed : useDroneStore.getState().armState !== "armed";
      switch (cond) {
        case "picker_open":
          return usePickerStore.getState().open;
        case "picker_closed":
          return !usePickerStore.getState().open;
        case "on_ground":
          return onGround;
        case "airborne":
          return !onGround;
        case "rth_active":
          return rth;
        case "not_rth":
          return !rth;
        case "vehicle_vtol":
          return pilot?.vehicleClass === "vtol";
        case "stick_l_centered": {
          const a = useInputStore.getState().padAxes;
          return Math.abs(a[0] ?? 0) < CENTERED_THRESHOLD && Math.abs(a[1] ?? 0) < CENTERED_THRESHOLD;
        }
        default:
          return false;
      }
    };
    const lastTick = new Map<Ds4Binding, number>();
    const engine = new GestureEngine(effectiveBindings({ bindings }), {
      when,
      fire: (b) => {
        // A confirm sheet owns input: only the safety bindings get through.
        if (useSkillConfirmStore.getState().pending !== null && !LOCKED[b.action]) return;
        // The open designate reticle takes the bare D-pad, Cross and Circle;
        // chords (Options + Circle, the kill hold) still reach their actions.
        if (b.with.length === 0 && !LOCKED[b.action] && reticleControl(b.control)) return;
        if (b.rumble && b.rumble !== "ramp" && b.rumble !== "countdown") rumble(b.rumble);
        runAction(droneId, b);
      },
      holdProgress: (b, p) => {
        if (p === null) {
          lastTick.delete(b);
          return;
        }
        const now = Date.now();
        const every = b.rumble === "countdown" ? 500 : 100;
        if (now - (lastTick.get(b) ?? 0) >= every) {
          lastTick.set(b, now);
          rumbleHoldTick(b.rumble, p);
        }
      },
    });
    // L2 / R2 analog: gimbal pitch rate on the drone's agent.
    const all = effectiveBindings({ bindings });
    const pitch = (action: string) => all.find((b) => b.gesture === "analog" && b.action === action);
    const down = pitch("gimbal_pitch_down");
    const up = pitch("gimbal_pitch_up");
    const gimbal =
      down || up ? new GimbalRateDriver(droneId, up?.rate_full_dps ?? down?.rate_full_dps ?? 60) : null;
    const trigger = (b: Ds4Binding | undefined, t: [number, number]) =>
      b?.control === "l2" ? t[0] : b?.control === "r2" ? t[1] : 0;
    const step = () => {
      const { buttons, triggers } = useInputStore.getState();
      const now = Date.now();
      engine.update((c) => buttons[WEB_BUTTON_INDEX[c] ?? -1] === true, now);
      gimbal?.tick(trigger(down, triggers), trigger(up, triggers), now);
    };
    const unsub = useInputStore.subscribe((s, prev) => {
      if (s.buttons !== prev.buttons) step();
    });
    const tick = setInterval(step, TICK_MS);
    return () => {
      unsub();
      clearInterval(tick);
      gimbal?.stop();
    };
  }, [droneId, bindings]);

  // Lightbar: follows the flight state, re-sent on change and for blink /
  // pulse patterns. Inert until a controller is granted over WebHID.
  useEffect(() => {
    let last = "";
    const tick = setInterval(() => {
      const nav = useNavStreamStore.getState().byDrone[droneId];
      const pilot = nav?.pilot?.data ?? null;
      const linkLost = nav?.pilot ? Date.now() - nav.pilot.receivedAt > 2000 : false;
      const remaining = useTelemetryStore.getState().battery.latest()?.remaining ?? null;
      const state = lightbarState(pilot, { lowBattery: remaining !== null && remaining >= 0 && remaining < 20, linkLost });
      const rgb = lightbarColour(state, Date.now());
      const key = rgb.join(",");
      if (key === last) return;
      last = key;
      void setLightbar(rgb);
    }, 100);
    return () => clearInterval(tick);
  }, [droneId]);
}
