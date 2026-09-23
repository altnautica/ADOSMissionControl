/**
 * Method-to-capability map for the postMessage bridge.
 *
 * Every method a plugin can call resolves to exactly one capability
 * the bridge gates on. A method missing from this map is rejected.
 * `null` capability means "always allowed" (theme, notify, i18n.t).
 */

import type { PluginCapability } from "./types";

/**
 * Reserved `command.send` name a plugin's GCS half uses to write its own
 * per-drone config. Routed to the drone's agent, never to the FC.
 */
export const PLUGIN_CONFIG_WRITE_COMMAND = "plugin.config.write";

/**
 * Reserved `command.send` name a plugin overlay uses to lock the vision
 * engine's tracker onto a clicked box. Routed to the agent's designate route.
 */
export const VISION_DESIGNATE_COMMAND = "vision.designate";

/** Resolver function so methods like telemetry.subscribe can derive
 * a per-stream capability id from their args. */
export type CapabilityResolver = (args: unknown) => string | null;

interface MethodRule {
  capability: PluginCapability | null;
  /**
   * Optional finer-grained derivation. If present and the method is
   * gated, the resolver runs after schema validation and produces the
   * effective capability id (e.g. `telemetry.subscribe.mavlink.attitude`).
   */
  resolve?: CapabilityResolver;
  /** Methods that take args.topic must have it as a string. */
  requireTopic?: boolean;
}

export const PLUGIN_METHOD_RULES: Record<string, MethodRule> = {
  ping: { capability: null },
  "theme.useTheme": { capability: null },
  notify: { capability: null },
  "notification.publish": { capability: "ui.slot.notification-channel" },
  "i18n.t": { capability: null },

  "telemetry.subscribe": {
    capability: "telemetry.subscribe",
    requireTopic: true,
    resolve: (args) => {
      const a = args as { topic?: unknown };
      return typeof a.topic === "string"
        ? `telemetry.subscribe.${a.topic}`
        : null;
    },
  },
  "telemetry.unsubscribe": { capability: null },

  "command.send": {
    capability: "command.send",
    // Retargeting the vision tracker is not a vehicle command, but whatever
    // follows the tracker flies toward the new lock, so it needs its own
    // grant rather than riding the generic command.send one.
    resolve: (args) =>
      (args as { command?: unknown } | null)?.command === VISION_DESIGNATE_COMMAND
        ? "vision.track.designate"
        : "command.send",
  },
  "recording.start": { capability: "recording.write" },
  "recording.stop": { capability: "recording.write" },
  "recording.mark": { capability: "recording.write" },
  "mission.read": { capability: "mission.read" },
  "mission.write": { capability: "mission.write" },

  "events.subscribe": {
    capability: "event.subscribe",
    requireTopic: true,
  },
  "events.publish": {
    capability: "event.publish",
    requireTopic: true,
  },
  // Always-allowed: dropping a subscription needs no grant (mirrors
  // telemetry.unsubscribe). requireTopic so a malformed call is rejected.
  "events.unsubscribe": { capability: null, requireTopic: true },

  "cloud.read": { capability: "cloud.read" },
  "cloud.write": { capability: "cloud.write" },

  // Composited cockpit draw-layer. A plugin that can mount a video overlay
  // posts vector MARKS (boxes/reticles/points/polylines/labels) that the host
  // composites into ONE letterbox-correct overlay, instead of each plugin
  // stacking its own iframe. Gated on the same slot capability the plugin was
  // granted to draw over the video; clearing needs no grant (mirrors the
  // unsubscribe methods).
  "cockpit.marks": { capability: "ui.slot.video-overlay" },
  "cockpit.marks.clear": { capability: null },

  // Read-only perception surface (ctx.perception). Detections + health key by
  // the plugin's bound drone (no args.topic), so a plain capability is enough.
  "perception.read": { capability: "perception.read" },
  "perception.subscribe": { capability: "perception.subscribe" },
  // Dropping a subscription needs no grant (mirrors telemetry.unsubscribe).
  "perception.unsubscribe": { capability: null },
  "perception.health": { capability: "perception.read" },
};

/**
 * Resolve the effective capability the caller must hold to invoke
 * `method` with `args`. Returns:
 *   - `null` if the method is unrestricted ("always allowed").
 *   - a string capability id if the caller must hold it.
 *   - `undefined` if the method is unknown — caller MUST reject.
 */
export function resolveRequiredCapability(
  method: string,
  args: unknown,
): string | null | undefined {
  const rule = PLUGIN_METHOD_RULES[method];
  if (!rule) return undefined;
  if (rule.requireTopic) {
    const a = args as { topic?: unknown };
    if (typeof a.topic !== "string") return undefined;
  }
  if (!rule.capability) return null;
  if (rule.resolve) return rule.resolve(args);
  return rule.capability;
}

export function isKnownMethod(method: string): boolean {
  return method in PLUGIN_METHOD_RULES;
}
