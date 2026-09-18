/**
 * Safety-critical plugin control handlers: `command.send` and `mission.write`.
 *
 * These are the only plugin RPCs that can command a LIVE vehicle, so each runs
 * a stack of operational gates ON TOP of the bridge's capability check (which
 * has already run before the handler fires — handlers never re-check
 * capabilities):
 *
 *   command.send
 *     - cross-drone guard: a token whose `agentId` claim differs from the
 *       plugin's scoped device is rejected (no targeting another drone).
 *     - hard-block list: a fixed set of MAV_CMD ids can NEVER be sent from a
 *       plugin, even with operator confirmation.
 *     - strict target: the protocol is resolved ONLY from the scoped deviceId
 *       (never the selected-drone fallback telemetry uses).
 *     - operator confirmation (armed-aware) before every send.
 *     - per-plugin rate limit on confirmed sends.
 *
 *   mission.write
 *     - refused while the vehicle is armed.
 *     - validated through the shared mission validator before anything else.
 *     - operator confirmation before the store write + upload.
 *
 * @module plugins/handlers/control
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { Waypoint } from "@/lib/types";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useMissionStore } from "@/stores/mission-store";
import { validateMission } from "@/lib/validation/mission-validator";
import { requestPluginConfirm } from "@/lib/plugins/confirm";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { VisionAgentClient } from "@/lib/agent/vision-client";
import { asRecord } from "./args";
import { checkCommandRateLimit } from "./command-rate";

/**
 * The reserved `command.send` name a plugin's GCS half uses to write its own
 * per-drone config (the iframe-settings counterpart to the Skill Bar toggle).
 * Matches the plugin SDK convention; routed to the live host, never to the FC.
 */
const PLUGIN_CONFIG_WRITE_COMMAND = "plugin.config.write";

/**
 * The reserved `command.send` name a plugin's video overlay uses to lock the
 * vision engine's tracker onto a clicked box (operator click-to-follow). Routed
 * to the agent's vision designate route, never to the FC. The engine returns
 * the new track id; the agent half follows whatever the engine has locked.
 */
const VISION_DESIGNATE_COMMAND = "vision.designate";

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

/**
 * Resolve the protocol for the plugin's scoped drone STRICTLY by deviceId.
 * Unlike telemetry, there is no selected-drone fallback — a command must go to
 * exactly the drone the plugin is bound to, or nowhere.
 */
function resolveStrictProtocol(deviceId: string | null): DroneProtocol | null {
  if (!deviceId) return null;
  return useDroneManager.getState().drones.get(deviceId)?.protocol ?? null;
}

/** A finite number, the only acceptable command param / coordinate element. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Minimal structural check for a waypoint-like object from the iframe. */
function isWaypointLike(value: unknown): value is Waypoint {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return (
    typeof w.id === "string" &&
    isFiniteNumber(w.lat) &&
    isFiniteNumber(w.lon) &&
    isFiniteNumber(w.alt)
  );
}

/**
 * Build the `command.send` + `mission.write` handlers for one plugin bound to
 * `deviceId`. No long-lived subscriptions are opened, so there is nothing to
 * dispose.
 */
export function buildControlHandlers(
  pluginId: string,
  deviceId: string | null,
): Record<string, BridgeHandler> {
  const commandSend: BridgeHandler = async (
    args,
    ctx: BridgeHandlerContext,
  ) => {
    // Cross-drone guard: a token minted for a different agent must never reach
    // this drone, even though the bridge already matched the token's agentId
    // to the selected drone. Belt-and-suspenders against a scope mismatch.
    if (
      ctx.claims?.agentId &&
      deviceId &&
      ctx.claims.agentId !== deviceId
    ) {
      return { ok: false, error: "command.send target mismatch" };
    }

    const a = asRecord(args);
    const command = a.command;
    if (typeof command !== "string") {
      return { ok: false, error: "command.send requires a command name" };
    }

    // Plugin per-drone config write (the iframe settings counterpart to the
    // Skill Bar toggle): NOT a vehicle command, so it bypasses the MAV_CMD
    // allowlist / confirm / rate-limit and instead writes the plugin's OWN
    // per-drone config to the live host over the LAN agent (scoped to this
    // plugin id, so it can never touch another plugin's config). A drone with
    // no LAN seam returns an honest error.
    if (command === PLUGIN_CONFIG_WRITE_COMMAND) {
      const cfg = asRecord(a.args);
      const key = cfg.key;
      if (typeof key !== "string" || key.length === 0) {
        return { ok: false, error: "plugin.config.write requires a string key" };
      }
      if (!deviceId) {
        return { ok: false, error: "plugin.config.write has no scoped drone" };
      }
      try {
        const ok = await writePluginConfigValue({
          droneId: deviceId,
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

    // Vision designate (operator click-to-follow from a plugin overlay): NOT a
    // vehicle command. It locks the vision engine's tracker onto the clicked
    // box via the agent's designate route; the agent half then follows whatever
    // the engine has locked. A drone with no LAN agent returns an honest error.
    if (command === VISION_DESIGNATE_COMMAND) {
      if (!deviceId) {
        return { ok: false, error: "vision.designate has no scoped drone" };
      }
      const p = asRecord(a.args);
      const cameraId = p.camera_id;
      const bboxRaw = asRecord(p.bbox);
      const x = bboxRaw.x;
      const y = bboxRaw.y;
      const width = bboxRaw.width;
      const height = bboxRaw.height;
      if (
        typeof cameraId !== "string" ||
        !isFiniteNumber(x) ||
        !isFiniteNumber(y) ||
        !isFiniteNumber(width) ||
        !isFiniteNumber(height)
      ) {
        return {
          ok: false,
          error: "vision.designate requires camera_id + a numeric bbox",
        };
      }
      const agent = resolveLocalAgentForDrone(deviceId);
      if (!agent) {
        return { ok: false, error: "no local agent seam for this drone" };
      }
      try {
        const client = new VisionAgentClient(agent.agentUrl, agent.apiKey);
        const result = await client.designate(
          cameraId,
          { x, y, width, height },
          {
            classLabel:
              typeof p.class_label === "string" ? p.class_label : undefined,
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

    const protocol = resolveStrictProtocol(deviceId);
    if (!protocol || !protocol.sendCommand) {
      return { ok: false, error: "command.send not supported" };
    }

    const params = entry.buildParams(asRecord(a.args));
    if (params === null) {
      return { ok: false, error: `invalid args for '${command}'` };
    }

    // Per-drone arm state, from this plugin's own node registry entry.
    // `useDroneStore` holds the OPERATOR'S selection, so a plugin bound to a
    // different aircraft escalated (or failed to escalate) the confirmation
    // dialog against the wrong vehicle's arm state.
    const armed =
      (deviceId
        ? useNodeRegistryStore.getState().getEntry(deviceId)?.fc.armState
        : undefined) === "armed";
    const ok = await requestPluginConfirm({
      pluginId,
      title: "Plugin command",
      body:
        `${pluginId} wants to send "${command}"` +
        (armed ? " while the vehicle is ARMED" : ""),
      severity: armed ? "critical" : "warning",
    });
    if (!ok) return { ok: false, error: "operator denied" };

    if (!checkCommandRateLimit(pluginId, Date.now())) {
      return { ok: false, error: "command rate limit exceeded" };
    }

    const res = await protocol.sendCommand(entry.id, params);
    return { ok: res.success, result: res };
  };

  const missionWrite: BridgeHandler = async (args) => {
    const a = asRecord(args);
    // The SDK MissionUpdate carries the data on `payload`; the host contract
    // for a write is `payload: { waypoints: Waypoint[] }`.
    const payload = asRecord(a.payload);
    const wpsRaw = payload.waypoints;
    if (!Array.isArray(wpsRaw) || !wpsRaw.every(isWaypointLike)) {
      return {
        ok: false,
        error: "mission.write requires payload.waypoints to be an array",
      };
    }
    const waypoints = wpsRaw as Waypoint[];

    // The armed guard and the upload target are BOTH resolved for the
    // plugin's own drone. `useDroneStore` is a single slot scoped to the
    // operator's selection, and `uploadMission()` with no target falls back to
    // that same selection — so a plugin bound to drone B uploaded to whichever
    // drone the operator was watching, having checked the wrong arm state to
    // get there. `command.send` already refuses the selection fallback via
    // `resolveStrictProtocol`; this is the same rule.
    const protocol = resolveStrictProtocol(deviceId);
    if (!protocol) {
      return { ok: false, error: "plugin is not bound to a connected drone" };
    }
    const fcState = deviceId
      ? useNodeRegistryStore.getState().getEntry(deviceId)?.fc
      : undefined;
    if (fcState?.armState === "armed") {
      return { ok: false, error: "cannot write mission while armed" };
    }

    const result = validateMission(waypoints);
    if (!result.valid) {
      return { ok: false, error: "invalid mission", errors: result.errors };
    }

    const ok = await requestPluginConfirm({
      pluginId,
      title: "Plugin mission write",
      body: `${pluginId} wants to replace the mission with ${waypoints.length} waypoints`,
      severity: "warning",
    });
    if (!ok) return { ok: false, error: "operator denied" };

    // setWaypoints snapshots undo history internally; the upload is pinned to
    // this plugin's own drone.
    useMissionStore.getState().setWaypoints(waypoints);
    const uploaded = await useMissionStore.getState().uploadMission(protocol);
    return { ok: uploaded };
  };

  return {
    "command.send": commandSend,
    "mission.write": missionWrite,
  };
}

/** Exported for tests so the hard-block list stays in lockstep with assertions. */
export const HARD_BLOCKED_COMMAND_IDS: ReadonlySet<number> =
  HARD_BLOCKED_COMMANDS;
