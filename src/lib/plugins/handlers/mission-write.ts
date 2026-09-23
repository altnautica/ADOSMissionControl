/**
 * The `mission.write` plugin handler.
 *
 * Replacing the mission on a live vehicle is safety-critical, so the handler
 * stacks gates on top of the bridge's capability check:
 *   - the waypoints are rebuilt into the planner shape (see
 *     `./mission-sanitize`), so nothing the encoder reads is plugin-typed;
 *   - the target is the plugin's own drone, never the operator's selection;
 *   - refused while the vehicle is armed, its arm state is unknown, or its FC
 *     link is down;
 *   - validated with the same options the planner's upload gate uses
 *     (geofence, zones, rally and the default altitude frame);
 *   - operator confirmation names the drone, the altitude frame and any
 *     advisory issues;
 *   - after the operator approves, the vehicle state is read again and the
 *     write is refused if the arm state, link or FC changed during the wait.
 *
 * @module plugins/handlers/mission-write
 * @license GPL-3.0-only
 */

import type { BridgeHandler } from "@/lib/plugins/bridge";
import { confirmRefusal, requestPluginConfirm } from "@/lib/plugins/confirm";
import { pluginNotify } from "@/lib/plugins/notifier";
import { validateMission } from "@/lib/validation/mission-validator";
import {
  buildValidationOptions,
  readValidationOptionsSnapshot,
} from "@/hooks/use-validation-options";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { asRecord } from "./args";
import { sanitizePluginWaypoints } from "./mission-sanitize";
import {
  readTargetVehicle,
  targetDisplayName,
  type PluginTarget,
  type TargetVehicleSnapshot,
} from "./target";

/** Why the vehicle cannot take a plugin mission write, or null when it can. */
function refusal(v: TargetVehicleSnapshot): string | null {
  if (v.armState === "armed") return "cannot write mission while armed";
  if (v.armState !== "disarmed") return "cannot write mission while the arm state is unknown";
  if (!v.fcConnected) return "cannot write mission while the flight controller link is down";
  return null;
}

export function buildMissionWriteHandler(
  pluginId: string,
  target: PluginTarget | null,
): BridgeHandler {
  return async (args) => {
    // The SDK MissionUpdate carries the data on `payload`; the host contract
    // for a write is `payload: { waypoints: Waypoint[] }`.
    const sanitized = sanitizePluginWaypoints(asRecord(asRecord(args).payload).waypoints);
    if (!sanitized.ok) {
      return { ok: false, error: `mission.write rejected: ${sanitized.error}` };
    }
    const waypoints = sanitized.waypoints;

    // `uploadMission()` with no protocol falls back to the operator's
    // selection, so the target protocol is resolved from the plugin's own
    // drone and passed explicitly.
    const protocol = target
      ? useDroneManager.getState().drones.get(target.nodeId)?.protocol
      : undefined;
    if (!target || !protocol) {
      return { ok: false, error: "plugin is not bound to a connected drone" };
    }
    const before = readTargetVehicle(target);
    const blocked = refusal(before);
    if (blocked) return { ok: false, error: blocked };

    const options = buildValidationOptions(readValidationOptionsSnapshot());
    const result = validateMission(waypoints, options);
    if (!result.valid) {
      return { ok: false, error: "invalid mission", errors: result.errors };
    }

    const frames = new Set(waypoints.map((w) => w.frame ?? options.defaultFrame));
    const advisories =
      result.warnings.length > 0 ? `, ${result.warnings.length} advisory issue(s)` : "";
    const name = targetDisplayName(target);
    const answer = await requestPluginConfirm({
      pluginId,
      targetName: name,
      targetId: target.deviceId,
      title: "Plugin mission write",
      body:
        `${pluginId} wants to replace the mission on ${name} with ${waypoints.length} waypoints ` +
        `(altitude frame: ${[...frames].join(", ")}${advisories})`,
      severity: "warning",
    });
    if (answer !== "approved") return { ok: false, error: confirmRefusal(answer) };

    // The operator may have answered long after the prompt: the pilot can arm
    // and launch, or the link can drop, while the dialog is open. Anything
    // that stops an approved write is reported to the operator as well.
    const report = (reason: string) =>
      pluginNotify(
        pluginId,
        `approved mission write for ${name} was not uploaded (${reason})`,
        "error",
      );
    const after = readTargetVehicle(target);
    const nowBlocked = refusal(after);
    if (nowBlocked) {
      report(nowBlocked);
      return { ok: false, error: nowBlocked };
    }
    if (
      after.managedId !== before.managedId ||
      useDroneManager.getState().drones.get(target.nodeId)?.protocol !== protocol
    ) {
      const changed = "the drone's flight controller changed while awaiting approval";
      report(changed);
      return { ok: false, error: changed };
    }

    // setWaypoints snapshots undo history internally; the upload is pinned to
    // this plugin's own drone.
    useMissionStore.getState().setWaypoints(waypoints);
    const uploaded = await useMissionStore.getState().uploadMission(protocol);
    if (!uploaded) report("the upload failed");
    return { ok: uploaded };
  };
}
