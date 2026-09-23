/**
 * Plugin event pub/sub handlers: `events.subscribe`, `events.unsubscribe`,
 * `events.publish`.
 *
 * Backed by the in-memory event bus in `../event-bus.ts`. A subscription
 * forwards every matching event to the iframe as a host event whose method is
 * the concrete topic itself, which is what the plugin SDK's
 * `ctx.events.subscribe(topic, handler)` listens for; the builder tracks each unsubscribe so `dispose()` tears
 * them all down (and `events.unsubscribe` drops one). The bridge gates the
 * `event.subscribe` / `event.publish` capability before the handler runs;
 * `events.unsubscribe` is always-allowed (stopping delivery needs no grant),
 * mirroring `telemetry.unsubscribe`.
 *
 * @module plugins/handlers/events
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import {
  isReservedEventTopic,
  publishPluginEvent,
  subscribePluginEvent,
} from "@/lib/plugins/event-bus";
import { asRecord, readString } from "./args";

/**
 * Build the event handlers for one plugin, plus a `dispose()` that drops every
 * subscription. Subscriptions are tracked per topic so a re-subscribe replaces
 * the prior one (idempotent), matching the telemetry handler's contract.
 */
export function buildEventHandlers(pluginId: string): {
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
} {
  const subs = new Map<string, () => void>();

  const subscribe: BridgeHandler = (args, ctx: BridgeHandlerContext) => {
    const topic = readString(args, "topic");
    if (!topic) return { ok: false, error: "events.subscribe requires a topic" };

    // Replace any prior subscription to the same topic.
    subs.get(topic)?.();

    const capability = ctx.capability ?? "";
    const unsub = subscribePluginEvent(topic, pluginId, (payload, t) => {
      if (!isReservedEventTopic(t)) ctx.postEvent(t, capability, payload);
    });
    subs.set(topic, unsub);
    return { ok: true };
  };

  const unsubscribe: BridgeHandler = (args) => {
    const topic = readString(args, "topic");
    if (!topic) {
      return { ok: false, error: "events.unsubscribe requires a topic" };
    }
    const unsub = subs.get(topic);
    if (!unsub) return { ok: false };
    unsub();
    subs.delete(topic);
    return { ok: true };
  };

  const publish: BridgeHandler = (args) => {
    const topic = readString(args, "topic");
    if (!topic) return { ok: false, error: "events.publish requires a topic" };
    if (isReservedEventTopic(topic)) {
      return { ok: false, error: `events.publish: ${topic} is a host-reserved topic` };
    }
    publishPluginEvent(topic, asRecord(args).payload, pluginId);
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
      "events.subscribe": subscribe,
      "events.unsubscribe": unsubscribe,
      "events.publish": publish,
    },
    dispose,
  };
}
