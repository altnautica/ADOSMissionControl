/**
 * Telemetry subscription handlers for the plugin bridge.
 *
 * `telemetry.subscribe` wires the protocol callback for a known topic on
 * the target drone and forwards every frame to the iframe as a host event
 * on `telemetry.<topic>`. `telemetry.unsubscribe` tears down one topic; the
 * builder's `dispose()` tears down all of them. The bridge has already
 * gated the per-topic `telemetry.subscribe.<topic>` capability before the
 * handler runs, so these never re-check capabilities.
 *
 * @module plugins/handlers/telemetry
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { BatteryData } from "@/lib/types";
import { useDroneManager } from "@/stores/drone-manager";
import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import type { PluginTarget } from "./target";

/**
 * The normalized battery sample served on the `battery` topic. Mirrors the
 * plugin SDK's `BatterySample` (packages/plugin-sdk protocol.ts); the raw
 * adapter shape stays available on `mavlink.battery`. Values the flight
 * controller does not report are null, never a fabricated zero.
 */
export interface PluginBatterySample {
  timestampMs: number;
  packId: number;
  cellVoltagesV: number[];
  totalVoltageV: number;
  currentA: number | null;
  consumedAh: number | null;
  remainingPercent: number | null;
  temperatureC: number | null;
  cellCount: number | null;
}

/** Normalize the adapter's battery frame for the `battery` topic. */
export function toBatterySample(b: BatteryData): PluginBatterySample {
  // MAVLink reports -1 for current, consumed and remaining when unknown.
  return {
    timestampMs: b.timestamp,
    packId: 0,
    cellVoltagesV: b.cellVoltages ?? [],
    totalVoltageV: b.voltage,
    currentA: b.current < 0 ? null : b.current,
    consumedAh: b.consumed < 0 ? null : b.consumed / 1000,
    remainingPercent: b.remaining < 0 ? null : b.remaining,
    temperatureC: b.temperature ?? null,
    cellCount: b.cellCount ?? null,
  };
}

/**
 * A topic-specific subscription: wires the matching protocol callback and
 * returns its unsubscribe. `emit` is called with each telemetry frame.
 */
type TopicSubscriber = (
  protocol: DroneProtocol,
  emit: (data: unknown) => void,
) => () => void;

/**
 * Telemetry topics the host serves, each mapped to the protocol callback that
 * feeds it. This table is the contract the SDK's `TELEMETRY_TOPICS` lists.
 * Both the dotted `mavlink.*` form and the plain channel name are accepted.
 * `battery` carries the normalized {@link PluginBatterySample};
 * `mavlink.battery` carries the adapter's raw frame. Unknown topics are
 * rejected by the handler.
 */
const TOPIC_SUBSCRIBERS: Record<string, TopicSubscriber> = {
  "mavlink.attitude": (p, emit) => p.onAttitude(emit),
  attitude: (p, emit) => p.onAttitude(emit),
  "mavlink.position": (p, emit) => p.onPosition(emit),
  position: (p, emit) => p.onPosition(emit),
  "mavlink.battery": (p, emit) => p.onBattery(emit),
  battery: (p, emit) => p.onBattery((b) => emit(toBatterySample(b))),
  "mavlink.gps": (p, emit) => p.onGps(emit),
  gps: (p, emit) => p.onGps(emit),
  "mavlink.vfr": (p, emit) => p.onVfr(emit),
  vfr: (p, emit) => p.onVfr(emit),
  "mavlink.rc": (p, emit) => p.onRc(emit),
  rc: (p, emit) => p.onRc(emit),
  "mavlink.SYS_STATUS": (p, emit) => p.onSysStatus(emit),
  sysStatus: (p, emit) => p.onSysStatus(emit),
  "mavlink.radio": (p, emit) => p.onRadio(emit),
  radio: (p, emit) => p.onRadio(emit),
  "mavlink.HEARTBEAT": (p, emit) => p.onHeartbeat(emit),
  heartbeat: (p, emit) => p.onHeartbeat(emit),
  "mavlink.STATUSTEXT": (p, emit) => p.onStatusText(emit),
  statustext: (p, emit) => p.onStatusText(emit),
  "mavlink.EVENT": (p, emit) => p.onEvent(emit),
  event: (p, emit) => p.onEvent(emit),
};

/** The set of known topics, for callers that want to advertise them. */
export const KNOWN_TELEMETRY_TOPICS: readonly string[] =
  Object.keys(TOPIC_SUBSCRIBERS);

/**
 * Resolve the protocol for the plugin's drone. A plugin bound to a drone reads
 * only that drone (never the operator's selection, which would feed it another
 * aircraft's telemetry); only a fleet-scoped plugin follows the selection.
 */
function resolveProtocol(target: PluginTarget | null): DroneProtocol | null {
  const mgr = useDroneManager.getState();
  if (target) return mgr.drones.get(target.nodeId)?.protocol ?? null;
  return mgr.getSelectedProtocol();
}

/** Read and validate the `topic` field off an untrusted args payload. */
function readTopic(args: unknown): string {
  const topic = (args as { topic?: unknown } | null | undefined)?.topic;
  if (typeof topic !== "string" || topic.length === 0) {
    throw new Error("telemetry topic must be a non-empty string");
  }
  return topic;
}

/**
 * Build the `telemetry.subscribe` / `telemetry.unsubscribe` handlers for one
 * plugin, plus a `dispose()` that drops every subscription. Subscriptions are
 * tracked per topic so a re-subscribe replaces the prior one (idempotent).
 */
export function buildTelemetryHandlers(target: PluginTarget | null): {
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
} {
  const subs = new Map<string, () => void>();

  const subscribe: BridgeHandler = (args, ctx: BridgeHandlerContext) => {
    const topic = readTopic(args);
    const sub = TOPIC_SUBSCRIBERS[topic];
    if (!sub) throw new Error(`unknown telemetry topic: ${topic}`);

    const protocol = resolveProtocol(target);
    if (!protocol) {
      throw new Error("no connected drone for telemetry subscription");
    }

    // Replace any prior subscription to the same topic.
    subs.get(topic)?.();

    const capability = ctx.capability ?? "";
    const unsub = sub(protocol, (data) =>
      ctx.postEvent(`telemetry.${topic}`, capability, data),
    );
    subs.set(topic, unsub);
    return { ok: true };
  };

  const unsubscribe: BridgeHandler = (args) => {
    const topic = readTopic(args);
    const unsub = subs.get(topic);
    if (!unsub) return { ok: false };
    unsub();
    subs.delete(topic);
    return { ok: true };
  };

  const dispose = () => {
    for (const unsub of subs.values()) {
      try {
        unsub();
      } catch {
        // Best-effort teardown; a throwing unsubscribe must not wedge the rest.
      }
    }
    subs.clear();
  };

  return {
    handlers: {
      "telemetry.subscribe": subscribe,
      "telemetry.unsubscribe": unsubscribe,
    },
    dispose,
  };
}
