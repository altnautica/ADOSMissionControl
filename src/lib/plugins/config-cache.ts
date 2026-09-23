/**
 * The per-(drone, plugin) config values this GCS has written and the agent
 * accepted. Every plugin config writer (the plugin's own
 * `plugin.config.write`, the native parameter panel, a Skill Bar toggle)
 * records here after a successful write, and the plugin's iframe host pushes
 * the merged map to the iframe as a `config.changed` event, so a setting
 * changed anywhere round-trips to the plugin's own UI.
 *
 * The map is seeded from the agent's own read-back when a plugin's iframe
 * mounts, so settings written in an earlier session reach the plugin too.
 * Only values the agent holds or accepted appear: a key absent from both keeps
 * the plugin's own default.
 *
 * @module plugins/config-cache
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";

/** Cache key for one plugin on one drone (`node:` or bare device id). */
export function pluginConfigKey(droneId: string, pluginId: string): string {
  return `${deviceIdFromNodeId(droneId) ?? droneId}::${pluginId}`;
}

interface PluginConfigCacheState {
  values: Record<string, Record<string, unknown>>;
  record: (droneId: string, pluginId: string, key: string, value: unknown) => void;
  /** Replace the map with the agent's read-back, which already holds every
   * write it accepted. */
  seed: (droneId: string, pluginId: string, values: Record<string, unknown>) => void;
}

export const usePluginConfigCache = create<PluginConfigCacheState>()((set) => ({
  values: {},
  record: (droneId, pluginId, key, value) =>
    set((s) => {
      const k = pluginConfigKey(droneId, pluginId);
      return { values: { ...s.values, [k]: { ...s.values[k], [key]: value } } };
    }),
  seed: (droneId, pluginId, values) =>
    set((s) => ({ values: { ...s.values, [pluginConfigKey(droneId, pluginId)]: values } })),
}));
