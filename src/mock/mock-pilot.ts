/**
 * @module mock/mock-pilot
 * @description The demo drone's ADOS Pilot. It stands in for
 * `WS /api/v1/pilot/stream` in demo mode: it accepts the cockpit's `pilot.v1`
 * frames (sticks, release, actions, session take) and publishes a `pilot`
 * kind at 10 Hz, so the flight-state chip, Mode sheet, skill picker and
 * stick stream run end to end without an agent.
 *
 * The pilot state mirrors the demo vehicle (its `MockProtocol` flight state):
 * AUTO is the FC flying its mission (owner `mission_fc`, the waypoint it flies
 * toward), RTL and LAND are the FC's own modes (owner `fc_mode`), disarmed is
 * `idle` on the ground. Actions drive that vehicle the way the real pilot
 * drives the FC: Land lands and disarms, RTH flies home, Pause in a mission
 * puts the FC in a hold mode (mission paused) and Resume puts it back in AUTO,
 * Kill stops the motors. Stick input echoes as owner `pilot`; a stick session
 * that stops streaming holds with `controller-lost`, as the real pilot does.
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import { usePluginSkillHostStore } from "@/lib/skills/plugin-skill-host-store";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import {
  handlePilotServerFrame,
  setPilotSender,
  type PilotOutboundFrame,
} from "@/lib/input/pilot-stream";
import { isDemoMode } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { demoNavStreamBlockedAt, demoTelemetryFrozen } from "./demo-link";
import { MockProtocol } from "./mock-protocol";

/** Publish rate of the demo `pilot` kind (the real pilot's 10 Hz). */
const PILOT_MS = 100;

/** Stick input older than this, with a session streaming, is a lost
 * controller (the real pilot's input-stale window). */
const INPUT_STALE_MS = 300;

/** Height a demo takeoff climbs to when the action names none, metres. */
const TAKEOFF_ALT_M = 10;

type Json = Record<string, unknown>;

/** The demo pilot's wire state (snake_case, as the agent sends it). */
export function demoPilotWire(over: Json = {}): Json {
  return {
    owner: "idle",
    owner_label: null,
    skill: null,
    vehicle_class: "multirotor",
    control_mode: "ados",
    profile: "normal",
    avoid: "brake",
    fc_mode: 4,
    fc_mode_name: "GUIDED",
    armed: false,
    landed: true,
    input_src: null,
    input_age_ms: null,
    hold_reason: null,
    avoid_state: "clear",
    min_clearance_m: null,
    goal_ned: null,
    plan_ned: [],
    setpoint_ned: null,
    readiness: [
      { id: "fc_profile", ok: true, severity: "block", msg: "FC failsafe parameters match the ADOS profile" },
      { id: "position", ok: true, severity: "block", msg: "Position estimate available" },
      { id: "agl", ok: true, severity: "warn", msg: "Rangefinder AGL available" },
    ],
    link_loss_in_s: null,
    mission: null,
    input_session: null,
    gate: null,
    sequence: null,
    banner: null,
    rth_countdown_s: null,
    ...over,
  };
}

/** Hand-to-FC choices: the copter custom mode (for a vehicle the demo does not
 * fly) and the FC mode it sets. */
const FC_MODE: Record<string, [number, UnifiedFlightMode]> = {
  loiter: [5, "LOITER"],
  poshold: [16, "POSHOLD"],
  althold: [2, "ALT_HOLD"],
};

/** FC modes that fly the vehicle home or down on their own. */
const FC_RETURN_MODES: Partial<Record<UnifiedFlightMode, true>> = { RTL: true, SMART_RTL: true, LAND: true };

/** FC hold modes: leaving a mission into one of them pauses it. */
const FC_HOLD_MODES: Partial<Record<UnifiedFlightMode, true>> = { LOITER: true, POSHOLD: true, BRAKE: true, ALT_HOLD: true };

/** How a mission the vehicle left stands: paused in a hold mode, or loaded
 * while the pilot flies (a stick takeover); either resumes in AUTO. */
type HeldMission = "paused" | "loaded";

export class MockPilot {
  private droneId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wire: Json = demoPilotWire();
  /** Fields a demo scenario pins on top of the live state. */
  private pinned: Json = {};
  private lastInputAt = 0;
  private log: { at: number; frame: PilotOutboundFrame }[] = [];
  /** The demo vehicle's mode at the last publish. */
  private lastMode: UnifiedFlightMode | null = null;
  private held: HeldMission | null = null;

  start(droneId: string): void {
    this.stop();
    this.droneId = droneId;
    this.wire = demoPilotWire();
    this.lastMode = null;
    this.held = null;
    setPilotSender((f) => this.receive(f), droneId);
    this.timer = setInterval(() => this.publish(), PILOT_MS);
    // Demo scenarios (and the cockpit screenshot run) pin chip states, e.g.
    // a paused mission, through this handle. Demo builds only.
    if (typeof window !== "undefined" && isDemoMode()) {
      (window as unknown as { __adosDemoPilot?: unknown }).__adosDemoPilot = {
        pin: (f: Json) => this.pin(f),
        // The last outbound frames with their receive time (browser checks of
        // the stick stream rate, axes and release).
        frames: () => this.log.slice(),
        // A plugin state report, as the agent's plugin event stream delivers
        // it (demo scenarios: an active skill whose reports stop).
        skillState: (topic: string, state: "active" | "idle" | "disabled") => {
          if (!this.droneId) return;
          const device = deviceIdFromNodeId(this.droneId) ?? this.droneId;
          usePluginSkillHostStore.getState().pushPluginSkillState(device, topic, { state });
        },
      };
    }
    this.publish();
  }

  stop(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    if (this.droneId) setPilotSender(null);
    this.droneId = null;
  }

  /** Pin fields over the live state (demo scenarios); `{}` clears. */
  pin(fields: Json): void {
    this.pinned = fields;
    this.publish();
  }

  /**
   * One `pilot` kind delivered by the reduced-rate `nav/status` poll (the
   * demo nav feed while its stream is blocked). Nothing while frozen.
   */
  publishPolled(): void {
    const droneId = this.droneId;
    if (!droneId || demoTelemetryFrozen()) return;
    const parsed = parsePilotState(this.snapshot());
    if (parsed) useNavStreamStore.getState().setPilot(droneId, parsed);
  }

  /** The demo vehicle this pilot flies, when the demo engine flies one. */
  private vehicle(): MockProtocol | null {
    const id = this.droneId;
    const protocol = id ? useDroneManager.getState().drones.get(id)?.protocol : undefined;
    return protocol instanceof MockProtocol ? protocol : null;
  }

  private receive(frame: PilotOutboundFrame): boolean {
    if (isDemoMode()) {
      this.log.push({ at: performance.now(), frame });
      if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    }
    switch (frame.op) {
      case "input": {
        this.lastInputAt = Date.now();
        const armed = this.vehicle()?.flight.armed ?? useDroneStore.getState().armState === "armed";
        if (armed && (this.wire.owner === "idle" || this.wire.owner === "pilot")) {
          this.wire.owner = "pilot";
        }
        this.wire.input_src = frame.src;
        this.wire.input_session = { src: frame.src, session: frame.session, label: "Mission Control" };
        break;
      }
      case "release":
        this.wire.input_src = null;
        break;
      case "session.take":
        this.wire.input_session = { src: frame.src, session: frame.session, label: "Mission Control" };
        break;
      case "hb":
        break;
      case "action": {
        const err = this.action(frame.name, frame.args ?? {});
        if (this.droneId) {
          handlePilotServerFrame(this.droneId, {
            kind: "action_result",
            name: frame.name,
            id: frame.id,
            ok: err === null,
            ...(err === null ? {} : { err }),
          });
        }
        this.publish();
        break;
      }
    }
    return true;
  }

  /** Apply one action; the refusal code, or null when it was accepted. */
  private action(name: string, args: Json): string | null {
    const [verb, value] = name.split(":");
    switch (verb) {
      case "profile":
        this.wire.profile = value;
        return null;
      case "control_mode":
        this.wire.control_mode = value;
        return null;
      case "avoid":
        this.wire.avoid = value;
        this.wire.avoid_state = value === "off" ? "off" : "clear";
        return null;
    }
    const vehicle = this.vehicle();
    return vehicle ? this.flyVehicle(vehicle, verb, args) : this.wireOnly(verb, args);
  }

  /** An action on the demo vehicle, with the real pilot's refusals. */
  private flyVehicle(p: MockProtocol, verb: string, args: Json): string | null {
    const f = p.flight;
    switch (verb) {
      case "arm":
        f.arm();
        return null;
      case "disarm":
        if (!f.armed) return "disarmed";
        if (f.airborne) return "not_landed";
        f.disarm();
        return null;
      case "kill":
        void p.killSwitch(true);
        return null;
      case "takeoff":
      case "launch": {
        if (!f.armed) f.arm();
        const alt = typeof args.alt_m === "number" ? args.alt_m : TAKEOFF_ALT_M;
        if (!f.airborne) f.takeoff(alt);
        this.wire.owner = "pilot";
        return null;
      }
      case "take_control":
        if (!f.armed) return "disarmed";
        f.setMode("GUIDED");
        this.wire.owner = "pilot";
        return null;
      case "pause":
        if (!f.armed) return "disarmed";
        if (!f.airborne) return "landed";
        if (f.mode === "AUTO") {
          // The FC holds where it is: the mission pauses, the FC flies.
          f.setMode("LOITER");
          this.wire.owner = "fc_mode";
          return null;
        }
        // Anything else: the pilot takes the vehicle and brakes to a hold.
        f.setMode("GUIDED");
        this.wire.owner = "pilot";
        return null;
      case "resume":
        if (!f.armed) return "disarmed";
        if (this.held === null) return "nothing_paused";
        f.setMode("AUTO");
        return null;
      case "hand_to_fc": {
        const [, mode] = FC_MODE[String(args.mode ?? "loiter")] ?? FC_MODE.loiter;
        f.setMode(mode);
        this.wire.owner = "fc_mode";
        return null;
      }
      case "rth":
        if (!f.armed) return "disarmed";
        if (!f.airborne) return "landed";
        void p.returnToLaunch();
        return null;
      case "land":
        if (!f.armed) return "disarmed";
        // The demo touches down at once; the FC then disarms on the ground.
        f.land();
        f.disarm();
        return null;
    }
    return "unknown_action";
  }

  /** An action with no demo vehicle behind it: only the owner moves. */
  private wireOnly(verb: string, args: Json): string | null {
    switch (verb) {
      case "take_control":
      case "takeoff":
      case "launch":
      case "pause":
      case "resume":
        this.wire.owner = "pilot";
        this.wire.fc_mode = 4;
        this.wire.fc_mode_name = "GUIDED";
        break;
      case "hand_to_fc": {
        const [num, label] = FC_MODE[String(args.mode ?? "loiter")] ?? FC_MODE.loiter;
        this.wire.owner = "fc_mode";
        this.wire.fc_mode = num;
        this.wire.fc_mode_name = label;
        break;
      }
      case "rth":
        this.wire.owner = "fc_mode";
        this.wire.fc_mode = 6;
        this.wire.fc_mode_name = "RTL";
        break;
      case "land":
        this.wire.owner = "fc_mode";
        this.wire.fc_mode = 9;
        this.wire.fc_mode_name = "LAND";
        break;
    }
    return null;
  }

  /** Bring the wire state in line with the demo vehicle. */
  private mirrorVehicle(p: MockProtocol): void {
    const f = p.flight;
    const w = this.wire;
    const prev = this.lastMode;
    this.lastMode = f.mode;
    w.armed = f.armed;
    w.landed = !f.airborne;
    w.fc_mode = customMode(p, f.mode);
    w.fc_mode_name = f.mode;

    if (!f.armed || !f.airborne) {
      this.held = null;
    } else if (f.mode === "AUTO" || FC_RETURN_MODES[f.mode]) {
      this.held = null;
    } else if (prev === "AUTO") {
      // Leaving the mission: a hold mode pauses it, any other mode (the
      // pilot's GUIDED) leaves it loaded to resume.
      this.held = FC_HOLD_MODES[f.mode] ? "paused" : "loaded";
    }

    if (!f.armed) {
      w.owner = "idle";
    } else if (f.mode === "AUTO") {
      w.owner = "mission_fc";
    } else if (FC_RETURN_MODES[f.mode]) {
      w.owner = "fc_mode";
    } else if (w.owner === "idle" || w.owner === "mission_fc") {
      // The FC flies a mode of its own (the mode bar, an RC switch).
      w.owner = "fc_mode";
    }

    const progress = f.missionProgress;
    const state = f.armed && f.mode === "AUTO" ? "active" : this.held;
    w.mission =
      state && progress
        ? { state, seq: progress.seq, total: progress.total, landing_seq: false }
        : null;
  }

  /** The current wire state, mirrored from the vehicle, with pins on top. */
  private snapshot(): Json {
    const vehicle = this.vehicle();
    if (vehicle) {
      this.mirrorVehicle(vehicle);
    } else {
      const armed = useDroneStore.getState().armState === "armed";
      this.wire.armed = armed;
      this.wire.landed = !armed;
      if (!armed) this.wire.owner = "idle";
    }
    const now = Date.now();
    this.wire.input_age_ms = this.lastInputAt ? now - this.lastInputAt : null;
    const lost =
      this.wire.owner === "pilot" &&
      this.wire.input_src !== null &&
      this.lastInputAt > 0 &&
      now - this.lastInputAt > INPUT_STALE_MS;
    this.wire.hold_reason = lost ? "controller-lost" : null;
    return { ...this.wire, ...this.pinned };
  }

  private publish(): void {
    const droneId = this.droneId;
    if (!droneId || demoTelemetryFrozen()) return;
    const data = this.snapshot();
    handlePilotServerFrame(droneId, { kind: "pilot", data });
    // The nav stream carries the pilot kind too; while it is blocked the
    // demo nav feed's fallback poll delivers it instead (publishPolled).
    if (demoNavStreamBlockedAt() !== null) return;
    const parsed = parsePilotState(data);
    if (parsed) useNavStreamStore.getState().setPilot(droneId, parsed);
  }
}

/** The FC's numeric custom mode for `mode`, or null when its firmware has none. */
function customMode(p: MockProtocol, mode: UnifiedFlightMode): number | null {
  try {
    return p.getFirmwareHandler().encodeFlightMode(mode).customMode;
  } catch {
    return null;
  }
}

/** Singleton demo pilot. */
export const mockPilot = new MockPilot();
