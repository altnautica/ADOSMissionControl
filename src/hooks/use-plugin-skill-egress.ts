"use client";

/**
 * @module use-plugin-skill-egress
 * @description Polls a LAN-paired drone's installed plugins for their latest
 * published state and feeds it into the two GCS-side seams so the cockpit
 * Skill Bar state ring and a plugin's iframe both reflect the plugin's own
 * reported state, live.
 *
 * The agent's plugin host writes each plugin's latest event per topic into a
 * state sidecar the native control front serves at
 * `GET /api/plugins/{id}/state`. For the selected drone this hook reads the
 * locally-installed plugins (`useLocalAgentPlugins`), polls each plugin's
 * state over the LAN every {@link POLL_INTERVAL_MS}, and:
 *
 *   1. for every topic a plugin's flight skills declare, maps the payload to a
 *      {@link PluginSkillReportedState} and pushes it to
 *      `usePluginSkillHostStore` so the Skill Bar's `getState` reads the
 *      plugin's true state (never optimistic GCS state); and
 *   2. republishes every published topic on the GCS plugin event bus under the
 *      plugin's own agent-state origin, which the plugin's iframe host on this
 *      drone forwards to the iframe (`ctx.events.subscribe(topic)`).
 *
 * Local-first only: the source hook is inert unless the operator is
 * signed out, not in demo, and holds a LAN key for the drone, so this hook
 * polls only when there is a real agent to reach. It stops on unmount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { useLocalAgentPlugins } from "@/hooks/use-local-agent-plugins";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { agentStateOrigin, publishPluginEvent } from "@/lib/plugins/event-bus";
import {
  usePluginSkillHostStore,
  type PluginSkillReportedState,
} from "@/lib/skills/plugin-skill-host-store";

/** How often to poll each plugin's published state, in ms. */
export const POLL_INTERVAL_MS = 750;

/** A mapped state plus the optional badge / reason the bar overlays. */
interface MappedState {
  state: PluginSkillReportedState;
  badge?: string;
  reason?: string;
}

/**
 * Map a plugin's published state payload to the discrete reported state the
 * Skill Bar reads. Honest by construction: a skill is "active" only when the
 * plugin reports it is actively engaged.
 *
 * A Follow-Me-style payload (`{ active, lock_state, commanding }`) maps:
 *   - `active: false`                       -> idle
 *   - `active: true` + `commanding: true`   -> active (locked + emitting)
 *   - `active: true`, not commanding        -> active with a badge naming the
 *     lock state (engaged but holding — uncertain / lost / coasting), so the
 *     operator sees it is on but not currently steering.
 *
 * A payload that carries an explicit `state` string ("active"/"idle"/
 * "disabled") is honoured directly (a generic plugin contract). Anything
 * unrecognised, or a non-object payload, is treated as idle.
 */
export function mapReportedState(payload: unknown): MappedState {
  if (typeof payload !== "object" || payload === null) {
    return { state: "idle" };
  }
  const p = payload as Record<string, unknown>;

  // Explicit state string wins (a generic plugin reporting its own verdict).
  if (
    p.state === "active" ||
    p.state === "idle" ||
    p.state === "disabled"
  ) {
    const badge = typeof p.badge === "string" ? p.badge : undefined;
    const reason = typeof p.reason === "string" ? p.reason : undefined;
    return { state: p.state, badge, reason };
  }

  // Follow-Me-style active/commanding/lock_state shape.
  if (typeof p.active === "boolean") {
    if (!p.active) return { state: "idle" };
    if (p.commanding === true) return { state: "active" };
    // Engaged but holding: active with a short badge from the lock state.
    const lock = typeof p.lock_state === "string" ? p.lock_state : undefined;
    const badge = lockBadge(lock);
    return badge ? { state: "active", badge } : { state: "active" };
  }

  return { state: "idle" };
}

/** A short (<= ~4 char) badge for a non-commanding lock state, or undefined. */
function lockBadge(lock: string | undefined): string | undefined {
  switch (lock) {
    case "uncertain":
      return "?";
    case "lost":
      return "!";
    default:
      return undefined;
  }
}

/**
 * Poll the selected drone's locally-installed plugins for their published
 * state and feed it to the Skill Bar store + the plugin event bus. No-op when
 * not local-first for the drone (the source hook returns null), in demo, or
 * when no drone is selected.
 *
 * @param droneId The selected drone's device id, or null/undefined.
 */
export function usePluginSkillEgress(droneId: string | null | undefined): void {
  const localPlugins = useLocalAgentPlugins(droneId ?? null);

  // Hold the latest plugin set without re-arming the interval on every render;
  // the interval reads it through the ref each tick. Synced in an effect (not
  // during render) so the latest value is mirrored after each commit.
  const pluginsRef = useRef(localPlugins);
  const droneRef = useRef(droneId);
  useEffect(() => {
    pluginsRef.current = localPlugins;
    droneRef.current = droneId;
  });

  useEffect(() => {
    // Only poll when there is a drone and a local-first plugin set to read.
    if (!droneId || !localPlugins || localPlugins.length === 0) return;

    let cancelled = false;
    // One sweep at a time: an agent slower than the interval would otherwise
    // stack a new request per plugin on every tick.
    let inFlight = false;

    const pollOnce = async () => {
      const id = droneRef.current;
      const plugins = pluginsRef.current;
      if (!id || !plugins || inFlight) return;
      inFlight = true;

      try {
      await Promise.all(
        plugins.map(async (plugin) => {
          // State egress polls the LAN agent that hosts the plugin; only an
          // `agent`-kind bundle (a per-drone install) has one. A fleet /
          // archive plugin has no agent to poll, so it is skipped here.
          if (plugin.bundle?.kind !== "agent") return;
          // The topics this plugin's flight skills declare feed the Skill Bar.
          const skillTopics = new Set(
            plugin.flightSkills
              .map((s) => s.stateTopic)
              .filter((t): t is string => typeof t === "string" && t.length > 0),
          );
          const client = new PluginAgentClient(
            plugin.bundle.agentUrl,
            plugin.bundle.apiKey,
          );
          const state = await client.getState(plugin.pluginId);
          if (cancelled || !state) return;

          const origin = agentStateOrigin(plugin.pluginId, id);
          for (const [topic, entry] of Object.entries(state)) {
            const payload = entry.payload;

            // (1) Feed the Skill Bar store so getState reads the true state.
            if (skillTopics.has(topic)) {
              const mapped = mapReportedState(payload);
              usePluginSkillHostStore.getState().pushPluginSkillState(id, topic, {
                state: mapped.state,
                ...(mapped.badge !== undefined ? { badge: mapped.badge } : {}),
                ...(mapped.reason !== undefined ? { reason: mapped.reason } : {}),
              });
            }

            // (2) Republish every topic onto the plugin event bus under the
            // plugin's own agent-state origin; the plugin's iframe host on
            // this drone forwards it (ctx.events.subscribe(topic)).
            publishPluginEvent(topic, payload, origin);
          }
        }),
      );
      } finally {
        inFlight = false;
      }
    };

    // Fire once immediately so the bar lights up without a poll-interval wait,
    // then on the interval.
    void pollOnce();
    const handle = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // Re-arm on drone switch or when the local plugin set changes identity
    // (the source hook memoizes its array). The refs carry the live values
    // between re-arms.
  }, [droneId, localPlugins]);
}
