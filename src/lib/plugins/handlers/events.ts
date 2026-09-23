/**
 * Plugin event pub/sub handlers: `events.subscribe`, `events.unsubscribe`,
 * `events.publish`.
 *
 * Backed by the in-memory event bus in `../event-bus.ts`. A subscription
 * forwards every matching event to the iframe as a host event whose method is
 * the concrete topic itself, which is what the plugin SDK's
 * `ctx.events.subscribe(topic, handler)` listens for. Subscriptions are held
 * per mount (iframe), so two panels of one plugin each keep their own;
 * `events.unsubscribe` drops one and the builder's `dispose()` drops all. The
 * bridge gates the `event.subscribe` / `event.publish` capability before the
 * handler runs; `events.unsubscribe` is always-allowed (stopping delivery
 * needs no grant), mirroring `telemetry.unsubscribe`.
 *
 * A plugin publishes only under its own namespace, `plugin.<pluginId>.`, so
 * the topic of every plugin-published event names its publisher: no plugin can
 * publish under another plugin's namespace or under a host topic (agent state,
 * vehicle events) and pose as that source to subscribers. Payloads are capped
 * at {@link MAX_EVENT_PAYLOAD_BYTES} because each one is cloned into every
 * subscribed iframe.
 *
 * @module plugins/handlers/events
 * @license GPL-3.0-only
 */

import type { BridgeHandler, BridgeHandlerContext } from "@/lib/plugins/bridge";
import {
  isAgentStateOrigin,
  isReservedEventTopic,
  publishPluginEvent,
  subscribePluginEvent,
} from "@/lib/plugins/event-bus";
import { asRecord, readString } from "./args";
import { perMount } from "./per-mount";

/** Largest serialised payload one `events.publish` may carry. */
export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;

function unsubscribeAll(subs: Map<string, () => void>): void {
  for (const unsub of subs.values()) {
    try {
      unsub();
    } catch {
      // Best-effort teardown; a throwing unsubscribe must not wedge the rest.
    }
  }
  subs.clear();
}

/** Serialised byte size of a payload, or null when it is not JSON. */
function payloadBytes(payload: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(payload) ?? "").length;
  } catch {
    return null;
  }
}

/**
 * Build the event handlers for one plugin, plus a `dispose()` that drops every
 * subscription. Within one mount, a re-subscribe to a topic replaces the prior
 * one (idempotent), matching the telemetry handler's contract.
 */
export function buildEventHandlers(pluginId: string): {
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
} {
  const mounts = perMount<Map<string, () => void>>(() => new Map(), unsubscribeAll);
  const ownPrefix = `plugin.${pluginId}.`;

  const subscribe: BridgeHandler = (args, ctx: BridgeHandlerContext) => {
    const topic = readString(args, "topic");
    if (!topic) return { ok: false, error: "events.subscribe requires a topic" };

    const subs = mounts.get(ctx.mount);
    subs.get(topic)?.();

    const capability = ctx.capability ?? "";
    // A plugin's agent-published state reaches only that plugin's own iframe
    // (the iframe host forwards it by origin), never another plugin's
    // subscription, whatever pattern it subscribed with.
    const unsub = subscribePluginEvent(topic, pluginId, (payload, t, origin) => {
      if (isReservedEventTopic(t) || isAgentStateOrigin(origin)) return;
      ctx.postEvent(t, capability, payload);
    });
    subs.set(topic, unsub);
    return { ok: true };
  };

  const unsubscribe: BridgeHandler = (args, ctx: BridgeHandlerContext) => {
    const topic = readString(args, "topic");
    if (!topic) {
      return { ok: false, error: "events.unsubscribe requires a topic" };
    }
    const subs = mounts.peek(ctx.mount);
    const unsub = subs?.get(topic);
    if (!subs || !unsub) return { ok: false };
    unsub();
    subs.delete(topic);
    return { ok: true };
  };

  const publish: BridgeHandler = (args) => {
    const topic = readString(args, "topic");
    if (!topic) return { ok: false, error: "events.publish requires a topic" };
    if (!topic.startsWith(ownPrefix) || topic.length === ownPrefix.length) {
      return {
        ok: false,
        error: `events.publish: a plugin publishes only under ${ownPrefix}*`,
      };
    }
    const payload = asRecord(args).payload;
    const bytes = payloadBytes(payload);
    if (bytes === null) {
      return { ok: false, error: "events.publish: payload is not JSON-serialisable" };
    }
    if (bytes > MAX_EVENT_PAYLOAD_BYTES) {
      return {
        ok: false,
        error: `events.publish: payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
      };
    }
    publishPluginEvent(topic, payload, pluginId);
    return { ok: true };
  };

  return {
    handlers: {
      "events.subscribe": subscribe,
      "events.unsubscribe": unsubscribe,
      "events.publish": publish,
    },
    dispose: () => mounts.disposeAll(),
  };
}
