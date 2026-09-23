/**
 * Safety-critical plugin control handlers: `command.send` and `mission.write`.
 *
 * These are the only plugin RPCs that can command a LIVE vehicle or steer
 * what it follows, so each runs a stack of operational gates ON TOP of the
 * bridge's capability check (which has already run before the handler fires
 * — handlers never re-check capabilities; `vision.designate` resolves to its
 * own `vision.track.designate` capability in the method table):
 *
 *   command.send (vehicle commands)
 *     - cross-drone guard: a token whose `agentId` claim differs from the
 *       plugin's drone is rejected (no targeting another drone).
 *     - allowlist + hard-block list: only a few named commands exist; a fixed
 *       set of MAV_CMD ids can NEVER be sent from a plugin.
 *     - strict target: the protocol is resolved ONLY from the plugin's drone
 *       (never the operator's selection).
 *     - operator confirmation (armed-aware), then the arm/link state is read
 *       again so the prompt's severity matched the vehicle that gets the
 *       command.
 *     - per-plugin rate limit on confirmed sends.
 *
 *   command.send "vision.designate" (retarget the follow tracker)
 *     - the same cross-drone guard, operator confirmation (critical while
 *       armed or unknown) and rate limit as a vehicle command: the agent's
 *       follow behaviour flies toward whatever the tracker locks.
 *
 *   command.send "plugin.config.write" writes only the plugin's own per-drone
 *   config and bypasses the vehicle gates.
 *
 *   mission.write: see `./mission-write.ts`.
 *
 * @module plugins/handlers/control
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import { useDroneManager } from "@/stores/drone-manager";
import { requestPluginConfirm } from "@/lib/plugins/confirm";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { VisionAgentClient } from "@/lib/agent/vision-client";
import {
  PLUGIN_CONFIG_WRITE_COMMAND,
  VISION_DESIGNATE_COMMAND,
} from "@/lib/plugins/methods";
import { asRecord } from "./args";
import { checkCommandRateLimit } from "./command-rate";
import { buildMissionWriteHandler } from "./mission-write";
import {
  readTargetVehicle,
  targetDisplayName,
  type PluginTarget,
  type TargetVehicleSnapshot,
} from "./target";

/**
 * MAV_CMD ids a plugin may NEVER send, regardless of capability or operator
 * confirmation. Each is either directly motion/arming critical or alters the
 * vehicle's safety configuration in a way no third-party plugin should drive.
 */
const HARD_BLOCKED_COMMANDS = new Set<number>([
  400, // MAV_CMD_COMPONENT_ARM_DISARM — arm/disarm is operator-only.
  209, // MAV_CMD_DO_MOTOR_TEST — spins motors on the bench/in hand.
  241, // MAV_CMD_PREFLIGHT_CALIBRATION — recalibrating sensors is unsafe mid-session.
  246, // MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN — reboots/shuts down the FC.
]);

/**
 * The ONLY commands a plugin may send, by high-level NAME. The host maps each
 * to a MAV_CMD id + parameter vector. Arming, motor test, calibration, reboot,
 * and every other command are intentionally ABSENT, so a plugin cannot reach
 * them at all — an unknown name is refused before any prompt or send. Every
 * allowed command is still operator-confirmed before it reaches the vehicle.
 */
const ALLOWED_NAMED_COMMANDS: Record<
  string,
  { id: number; buildParams: (args: Record<string, unknown>) => number[] | null }
> = {
  // Climb to a target altitude in metres (the operator arms first).
  takeoff: {
    id: 22, // MAV_CMD_NAV_TAKEOFF
    buildParams: (args) => {
      const alt = args.alt;
      if (!isFiniteNumber(alt)) return null;
      const clamped = Math.min(Math.max(alt, 1), 120);
      return [0, 0, 0, 0, 0, 0, clamped];
    },
  },
  // Land in place.
  land: { id: 21, buildParams: () => [0, 0, 0, 0, 0, 0, 0] }, // MAV_CMD_NAV_LAND
  // Return to launch.
  rtl: { id: 20, buildParams: () => [0, 0, 0, 0, 0, 0, 0] }, // MAV_CMD_NAV_RETURN_TO_LAUNCH
};

/** A finite number, the only acceptable command param / coordinate element. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A vehicle that may be flying: armed, or arm state not known. */
function mayBeFlying(v: TargetVehicleSnapshot): boolean {
  return v.armState !== "disarmed";
}

/** Confirmation-copy suffix describing the vehicle's arm state. */
function armSuffix(v: TargetVehicleSnapshot): string {
  if (v.armState === "armed") return " while the vehicle is ARMED";
  if (v.armState === "disarmed") return "";
  return " while the vehicle's arm state is UNKNOWN (link lost)";
}

/**
 * Re-read the vehicle after the operator answered. The prompt's severity was
 * chosen for the state at prompt time; a change during the wait (the pilot
 * armed, the link dropped, the FC was swapped) voids the approval.
 */
function changedSincePrompt(
  target: PluginTarget,
  before: TargetVehicleSnapshot,
): string | null {
  const after = readTargetVehicle(target);
  if (
    after.armState !== before.armState ||
    after.fcConnected !== before.fcConnected ||
    after.managedId !== before.managedId
  ) {
    return "the drone's arm or link state changed while awaiting approval";
  }
  return null;
}

/**
 * Build the `command.send` + `mission.write` handlers for one plugin bound to
 * `target`. No long-lived subscriptions are opened, so there is nothing to
 * dispose.
 */
export function buildControlHandlers(
  pluginId: string,
  target: PluginTarget | null,
): Record<string, BridgeHandler> {
  const designate = async (p: Record<string, unknown>, t: PluginTarget) => {
    const cameraId = p.camera_id;
    const bbox = asRecord(p.bbox);
    const { x, y, width, height } = bbox;
    if (
      typeof cameraId !== "string" ||
      !isFiniteNumber(x) ||
      !isFiniteNumber(y) ||
      !isFiniteNumber(width) ||
      !isFiniteNumber(height)
    ) {
      return { ok: false, error: "vision.designate requires camera_id + a numeric bbox" };
    }
    const agent = resolveLocalAgentForDrone(t.deviceId);
    if (!agent) {
      return { ok: false, error: "no local agent seam for this drone" };
    }
    // Retargeting the tracker retargets whatever follows it, so the operator
    // approves every designation; an airborne (or unknown) vehicle escalates.
    const before = readTargetVehicle(t);
    const ok = await requestPluginConfirm({
      pluginId,
      targetName: targetDisplayName(t),
      title: "Plugin follow target",
      body: `${pluginId} wants to change the tracked follow target${armSuffix(before)}`,
      severity: mayBeFlying(before) ? "critical" : "warning",
    });
    if (!ok) return { ok: false, error: "operator denied" };
    const changed = changedSincePrompt(t, before);
    if (changed) return { ok: false, error: changed };
    if (!checkCommandRateLimit(pluginId, Date.now())) {
      return { ok: false, error: "command rate limit exceeded" };
    }
    try {
      const client = new VisionAgentClient(agent.agentUrl, agent.apiKey);
      const result = await client.designate(
        cameraId,
        { x, y, width, height },
        {
          classLabel: typeof p.class_label === "string" ? p.class_label : undefined,
          confidence: isFiniteNumber(p.confidence) ? p.confidence : undefined,
        },
      );
      return { ok: result.designated, result };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "vision designate failed",
      };
    }
  };

  const commandSend: BridgeHandler = async (
    args,
    ctx: BridgeHandlerContext,
  ) => {
    // Cross-drone guard: a token minted for a different agent must never reach
    // this drone. Token `agentId` claims carry the bare agent device id.
    if (ctx.claims?.agentId && target && ctx.claims.agentId !== target.deviceId) {
      return { ok: false, error: "command.send target mismatch" };
    }

    const a = asRecord(args);
    const command = a.command;
    if (typeof command !== "string") {
      return { ok: false, error: "command.send requires a command name" };
    }

    // Plugin per-drone config write (the iframe settings counterpart to the
    // Skill Bar toggle): NOT a vehicle command. It writes the plugin's OWN
    // per-drone config to the live host over the LAN agent (scoped to this
    // plugin id, so it can never touch another plugin's config).
    if (command === PLUGIN_CONFIG_WRITE_COMMAND) {
      const cfg = asRecord(a.args);
      const key = cfg.key;
      if (typeof key !== "string" || key.length === 0) {
        return { ok: false, error: "plugin.config.write requires a string key" };
      }
      if (!target) {
        return { ok: false, error: "plugin.config.write has no scoped drone" };
      }
      try {
        const ok = await writePluginConfigValue({
          droneId: target.deviceId,
          pluginId,
          key,
          value: cfg.value,
        });
        return ok
          ? { ok: true, result: { set: true, key } }
          : { ok: false, error: "no local agent seam for this drone" };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "plugin config write failed",
        };
      }
    }

    if (command === VISION_DESIGNATE_COMMAND) {
      if (!target) {
        return { ok: false, error: "vision.designate has no scoped drone" };
      }
      return designate(asRecord(a.args), target);
    }

    // The allowlist is the primary gate: a plugin may only send the few named
    // commands the host maps. Anything else — including arm / motor-test /
    // calibration / reboot, which are simply never listed — is refused before
    // any prompt or send. The hard-block id check is belt-and-suspenders.
    const entry = ALLOWED_NAMED_COMMANDS[command];
    if (!entry || HARD_BLOCKED_COMMANDS.has(entry.id)) {
      return {
        ok: false,
        error: `command '${command}' is not permitted from plugins`,
      };
    }

    const protocol = target
      ? useDroneManager.getState().drones.get(target.nodeId)?.protocol
      : undefined;
    if (!target || !protocol || !protocol.sendCommand) {
      return { ok: false, error: "command.send not supported" };
    }

    const params = entry.buildParams(asRecord(a.args));
    if (params === null) {
      return { ok: false, error: `invalid args for '${command}'` };
    }

    // Arm state comes from this plugin's own node registry entry, not the
    // operator's selection. A lost link leaves the arm state unknown, which
    // escalates like armed: the aircraft may be flying.
    const before = readTargetVehicle(target);
    const ok = await requestPluginConfirm({
      pluginId,
      targetName: targetDisplayName(target),
      title: "Plugin command",
      body: `${pluginId} wants to send "${command}"${armSuffix(before)}`,
      severity: mayBeFlying(before) ? "critical" : "warning",
    });
    if (!ok) return { ok: false, error: "operator denied" };
    const changed = changedSincePrompt(target, before);
    if (changed) return { ok: false, error: changed };

    if (!checkCommandRateLimit(pluginId, Date.now())) {
      return { ok: false, error: "command rate limit exceeded" };
    }

    const res = await protocol.sendCommand(entry.id, params);
    return { ok: res.success, result: res };
  };

  return {
    "command.send": commandSend,
    "mission.write": buildMissionWriteHandler(pluginId, target),
  };
}

/** Exported for tests so the hard-block list stays in lockstep with assertions. */
export const HARD_BLOCKED_COMMAND_IDS: ReadonlySet<number> =
  HARD_BLOCKED_COMMANDS;
