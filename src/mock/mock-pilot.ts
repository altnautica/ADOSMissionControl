/**
 * @module mock/mock-pilot
 * @description The demo drone's ADOS Pilot. It stands in for
 * `WS /api/v1/pilot/stream` in demo mode: it accepts the cockpit's `pilot.v1`
 * frames (sticks, release, actions, session take) and publishes a `pilot`
 * kind at 10 Hz, so the flight-state chip, Mode sheet, skill picker and
 * stick stream run end to end without an agent. Stick input echoes as owner
 * `pilot`; actions move the owner the way the real pilot does.
 * @license GPL-3.0-only
 */

import { parsePilotState } from "@/lib/cockpit/layers/cockpit-frames";
import {
  handlePilotServerFrame,
  setPilotSender,
  type PilotOutboundFrame,
} from "@/lib/input/pilot-stream";
import { isDemoMode } from "@/lib/utils";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

/** Publish rate of the demo `pilot` kind (the real pilot's 10 Hz). */
const PILOT_MS = 100;

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

const FC_MODE: Record<string, [number, string]> = {
  loiter: [5, "LOITER"],
  poshold: [16, "POSHOLD"],
  althold: [2, "ALT_HOLD"],
};

export class MockPilot {
  private droneId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wire: Json = demoPilotWire();
  /** Fields a demo scenario pins on top of the live state. */
  private pinned: Json = {};
  private lastInputAt = 0;
  private log: { at: number; frame: PilotOutboundFrame }[] = [];

  start(droneId: string): void {
    this.stop();
    this.droneId = droneId;
    this.wire = demoPilotWire();
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

  private receive(frame: PilotOutboundFrame): boolean {
    if (isDemoMode()) {
      this.log.push({ at: performance.now(), frame });
      if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    }
    const armed = useDroneStore.getState().armState === "armed";
    switch (frame.op) {
      case "input":
        this.lastInputAt = Date.now();
        if (armed && (this.wire.owner === "idle" || this.wire.owner === "pilot")) {
          this.wire.owner = "pilot";
        }
        this.wire.input_src = frame.src;
        this.wire.input_session = { src: frame.src, session: frame.session, label: "Mission Control" };
        break;
      case "release":
        this.wire.input_src = null;
        break;
      case "session.take":
        this.wire.input_session = { src: frame.src, session: frame.session, label: "Mission Control" };
        break;
      case "hb":
        break;
      case "action":
        this.action(frame.name, frame.args ?? {});
        if (this.droneId) {
          handlePilotServerFrame(this.droneId, { kind: "action_result", name: frame.name, id: frame.id, ok: true });
        }
        break;
    }
    return true;
  }

  private action(name: string, args: Json): void {
    const [verb, value] = name.split(":");
    switch (verb) {
      case "profile":
        this.wire.profile = value;
        break;
      case "control_mode":
        this.wire.control_mode = value;
        break;
      case "avoid":
        this.wire.avoid = value;
        this.wire.avoid_state = value === "off" ? "off" : "clear";
        break;
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
  }

  private publish(): void {
    const droneId = this.droneId;
    if (!droneId) return;
    const armed = useDroneStore.getState().armState === "armed";
    this.wire.armed = armed;
    this.wire.landed = !armed;
    if (!armed) this.wire.owner = "idle";
    this.wire.input_age_ms = this.lastInputAt ? Date.now() - this.lastInputAt : null;
    const data = { ...this.wire, ...this.pinned };
    handlePilotServerFrame(droneId, { kind: "pilot", data });
    const parsed = parsePilotState(data);
    if (parsed) useNavStreamStore.getState().setPilot(droneId, parsed);
  }
}

/** Singleton demo pilot. */
export const mockPilot = new MockPilot();
