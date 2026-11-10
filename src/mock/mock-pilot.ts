/**
 * @module mock/mock-pilot
 * @description The demo drone's ADOS Pilot. It stands in for
 * `WS /api/v1/pilot/stream` in demo mode: it accepts the cockpit's `pilot.v1`
 * frames (sticks, release, actions, session take) and publishes a `pilot`
 * kind at 10 Hz, so the flight-state chip, Mode sheet, skill picker and
 * stick stream run end to end without an agent.
 *
 * The pilot state mirrors the demo vehicle and actions drive it (see
 * mock-pilot-vehicle). Stick input echoes as owner `pilot`; a stick session
 * that stops streaming holds with `controller-lost`, as the real pilot does.
 * Demo scenarios pin states the vehicle does not fly on its own (an FC
 * failsafe, a tuning step) through `window.__adosDemoPilot` (see
 * mock-pilot-wire); each drone's session starts without the last one's pins.
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePluginSkillHostStore } from "@/lib/skills/plugin-skill-host-store";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
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
import { DEMO_DRONES } from "./drones";
import { DEMO_SURFACE_OPS, PilotPins, demoPilotWire, type Json } from "./mock-pilot-wire";
import { DemoVehicleDriver } from "./mock-pilot-vehicle";

export { demoPilotWire } from "./mock-pilot-wire";

/** The demo pilot's console handle (demo builds only). */
export interface DemoPilotHandle {
  /** Pin wire fields over the live state; `{}` clears. */
  pin: (fields: Json) => void;
  /** The last outbound frames with their receive time. */
  frames: () => { at: number; frame: PilotOutboundFrame }[];
  /** A plugin state report, as the agent's plugin event stream delivers it. */
  skillState: (topic: string, state: "active" | "idle" | "disabled") => void;
}

declare global {
  interface Window {
    __adosDemoPilot?: DemoPilotHandle;
  }
}

/** Publish rate of the demo `pilot` kind (the real pilot's 10 Hz). */
const PILOT_MS = 100;

/** Stick input older than this, with a session streaming, is a lost
 * controller: the real pilot brakes with hold reason `controller-lost`. */
const INPUT_STALE_MS = 300;

/** Actions that are an operator's mode change: they end an FC failsafe. */
const OPERATOR_MODE_CHANGE: Record<string, true> = { take_control: true, hand_to_fc: true };

export class MockPilot {
  private droneId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wire: Json = this.freshWire();
  private pins = new PilotPins();
  private driver = new DemoVehicleDriver();
  private lastInputAt = 0;
  private log: { at: number; frame: PilotOutboundFrame }[] = [];

  start(droneId: string): void {
    this.stop();
    this.droneId = droneId;
    this.wire = this.freshWire();
    this.pins.clear();
    this.lastInputAt = 0;
    const device = deviceIdFromNodeId(droneId) ?? droneId;
    const cfg = DEMO_DRONES.find((d) => d.id === device);
    this.driver.reset(cfg ? { lat: cfg.homeLat, lon: cfg.homeLon } : null);
    setPilotSender((f) => this.receive(f), droneId);
    this.timer = setInterval(() => this.publish(), PILOT_MS);
    // Demo scenarios (and the cockpit screenshot run) pin chip states, e.g.
    // a paused mission, through this handle. Demo builds only.
    if (typeof window !== "undefined" && isDemoMode()) {
      window.__adosDemoPilot = {
        pin: (f) => this.pin(f),
        // Browser checks of the stick stream rate, axes and release.
        frames: () => this.log.slice(),
        // Demo scenarios: an active skill whose reports stop.
        skillState: (topic, state) => {
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
    if (typeof window !== "undefined") delete window.__adosDemoPilot;
  }

  /** Pin fields over the live state (demo scenarios); `{}` clears. */
  pin(fields: Json): void {
    this.pins.set(fields);
    this.publish();
  }

  /**
   * The pilot flies the Follow-Me skill: armed, owner `skill`, the skill the
   * Follow-Me plugin's. Only then does the demo follow-me feed report, as an
   * agent's does; a mission, a failsafe return or the ground report none.
   */
  followSkillActive(): boolean {
    if (!this.droneId) return false;
    const seen = this.pins.over(this.wire);
    const skill = seen.skill as Json | null | undefined;
    return seen.armed === true && seen.owner === "skill" && skill?.plugin_id === FOLLOW_ME_PLUGIN_ID;
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

  private freshWire(): Json {
    return demoPilotWire({ surface_ops: [...DEMO_SURFACE_OPS] });
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
    const seen = this.pins.over(this.wire);
    const err = vehicle
      ? this.driver.act(vehicle, this.wire, seen, verb, args)
      : this.driver.wireOnly(this.wire, seen, verb, args);
    if (err === null && OPERATOR_MODE_CHANGE[verb]) this.pins.clearFailsafe();
    return err;
  }

  /** The current wire state, mirrored from the vehicle, with pins on top. */
  private snapshot(): Json {
    const vehicle = this.vehicle();
    if (vehicle) {
      if (this.driver.mirror(vehicle, this.wire)) this.pins.clearFailsafe();
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
    // The goal is the goto's own: any other owner flies none.
    if (this.wire.owner !== "goto") this.wire.goal_ned = null;
    const seen = this.pins.over(this.wire);
    // Outside `ados` the FC flies, and a surface repositions it directly.
    if (seen.control_mode !== "ados") seen.surface_ops = [];
    return seen;
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

/** Singleton demo pilot. */
export const mockPilot = new MockPilot();
