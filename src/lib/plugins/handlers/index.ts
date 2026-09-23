/**
 * Plugin RPC handlers wired into the postMessage bridge.
 *
 * `buildPluginHandlers` returns the full handler surface for one plugin
 * instance bound to a device:
 *   - low-consequence: ping, i18n.t, mission.read, notify,
 *     notification.publish, recording start/stop/mark (the plugin's own
 *     recording slot; marks may annotate the flight recording), telemetry
 *     subscribe,
 *     perception read/subscribe/health (read-only derived detection data),
 *     cockpit marks (post vector marks into the composited draw-layer).
 *   - events: events.subscribe / unsubscribe / publish (in-memory bus).
 *   - cloud: cloud.read (allowlisted public queries) / cloud.write (refused).
 *   - safety-critical: command.send (including vision.designate) +
 *     mission.write, each gated by operator confirmation, a strict per-drone
 *     target, and a re-check of the vehicle state after the operator answers
 *     (see ./control.ts, ./mission-write.ts).
 *
 * The bridge gates the required capability before a handler runs, so handlers
 * never re-check capabilities — they add the OPERATIONAL safety gates on top.
 * Every handler is defensive about its args, which arrive as `unknown` from
 * the sandboxed iframe.
 *
 * @module plugins/handlers
 * @license GPL-3.0-only
 */

import type { BridgeHandler } from "@/lib/plugins/bridge";
import { pluginNotify, type PluginNotifyStatus } from "@/lib/plugins/notifier";
import { useMissionStore } from "@/stores/mission-store";
import {
  isRecordingFor,
  markRecording,
  startMirrorRecording,
  stopRecordingFor,
} from "@/lib/telemetry-recorder";
import { buildTelemetryHandlers } from "./telemetry";
import { buildPerceptionHandlers } from "./perception";
import { buildEventHandlers } from "./events";
import { buildControlHandlers } from "./control";
import { buildMarksHandlers } from "./marks";
import { buildCloudHandlers, type CloudQuery } from "./cloud";
import { asRecord, readString, readRecord } from "./args";
import { resolvePluginTarget, targetDisplayName } from "./target";

export interface PluginHandlerDeps {
  translate: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Runs a Convex function for `cloud.read` on the plugin's behalf. The
   * contribution producer wires this later; when absent, `cloud.read`
   * returns an error result (never throws).
   */
  cloudQuery?: CloudQuery;
}

/** Map an SDK NotificationPayload severity onto a toast status. */
function toNotifyStatus(severity: unknown): PluginNotifyStatus {
  if (severity === "critical" || severity === "error") return "error";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "info";
}

/**
 * Build the full handler set for one plugin instance bound to a drone.
 * `droneId` is the id the host mounted against (a `node:` selection id, an
 * `fc:` direct-FC id, or a bare agent device id); it is resolved once into the
 * node id the fleet stores key on and the device id agent reach keys on, and
 * each handler uses the right half. A null `droneId` is a fleet-scoped plugin:
 * telemetry follows the operator's selection, and every drone-targeted RPC
 * (command.send, mission.write, recording) is refused. `dispose()` tears down
 * all telemetry + event subscriptions.
 */
export function buildPluginHandlers(
  pluginId: string,
  droneId: string | null,
  deps: PluginHandlerDeps,
): { handlers: Record<string, BridgeHandler>; dispose: () => void } {
  const target = resolvePluginTarget(droneId);
  const telemetry = buildTelemetryHandlers(target);
  // Detections are keyed by the fleet selection id.
  const perception = buildPerceptionHandlers(target?.nodeId ?? null);
  const events = buildEventHandlers(pluginId);
  const control = buildControlHandlers(pluginId, target);
  const marks = buildMarksHandlers(pluginId);
  const cloud = buildCloudHandlers(pluginId, deps.cloudQuery);
  // A plugin's recordings live in their own slot fed from the drone's frame
  // stream, so a plugin can never stop (or be stopped by) the operator's
  // flight recording.
  const pluginSlot = target ? `plugin:${pluginId}:${target.nodeId}` : null;

  const handlers: Record<string, BridgeHandler> = {
    ping: () => ({ ok: true }),

    "i18n.t": (args) => {
      const key = readString(args, "key");
      if (key === undefined) throw new Error("i18n.t requires a string key");
      const params = readRecord(args, "params") as
        | Record<string, string | number>
        | undefined;
      return deps.translate(key, params);
    },

    "mission.read": () => {
      // Copy arrays (and the waypoint objects) so the iframe can never mutate
      // live store state through the returned reference.
      const s = useMissionStore.getState();
      return {
        waypoints: s.waypoints.map((w) => ({ ...w })),
        activeMission: s.activeMission
          ? {
              ...s.activeMission,
              waypoints: (s.activeMission.waypoints ?? []).map((w) => ({
                ...w,
              })),
            }
          : null,
        progress: s.progress,
        currentWaypoint: s.currentWaypoint,
      };
    },

    notify: (args) => {
      pluginNotify(readString(args, "message") ?? "", "info");
      return { ok: true };
    },

    "notification.publish": (args) => {
      const message =
        readString(args, "title") ??
        readString(args, "message") ??
        readString(args, "body") ??
        "";
      pluginNotify(message, toNotifyStatus(asRecord(args).severity));
      return { ok: true };
    },

    "recording.start": () => {
      if (!target || !pluginSlot) {
        return { ok: false, error: "recording needs a drone-bound plugin" };
      }
      if (isRecordingFor(pluginSlot)) {
        return { ok: false, error: "already recording" };
      }
      const recordingId = startMirrorRecording(
        pluginSlot,
        target.nodeId,
        targetDisplayName(target),
      );
      return { ok: true, recordingId };
    },

    "recording.stop": async () => {
      const recording = pluginSlot ? await stopRecordingFor(pluginSlot) : null;
      return recording
        ? { ok: true, recording }
        : { ok: false, error: "not recording" };
    },

    "recording.mark": (args) => {
      if (!target || !pluginSlot) return { ok: false, error: "not recording" };
      const label = readString(args, "label") ?? "";
      // SDK RecordingMark carries extra data on `meta`. A mark lands on the
      // plugin's own recording when one runs, else on the drone's flight
      // recording (a mark annotates; it never starts or stops anything).
      const meta = readRecord(args, "meta");
      const slot = isRecordingFor(pluginSlot) ? pluginSlot : target.nodeId;
      const ok = markRecording(slot, label, meta);
      return ok ? { ok: true } : { ok: false, error: "not recording" };
    },

    ...telemetry.handlers,
    ...perception.handlers,
    ...events.handlers,
    ...control,
    ...marks.handlers,
    ...cloud,
  };

  return {
    handlers,
    dispose: () => {
      telemetry.dispose();
      perception.dispose();
      events.dispose();
      marks.dispose();
    },
  };
}
