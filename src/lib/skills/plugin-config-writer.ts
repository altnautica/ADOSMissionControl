"use client";

/**
 * The live config-write seam for plugin skills, plugin target actions and
 * plugin iframe settings.
 *
 * A plugin skill's activate/deactivate (and a plugin's per-drone settings
 * inputs) flip the plugin's per-drone config; the plugin reads that config
 * each tick from the LIVE store in the running `ados-plugin-host`. This module
 * is the writer the host store (`plugin-skill-host-store`) calls. It reaches
 * the drone's agent the way every plugin wire call does
 * (`resolveNodeAgentReach`): the drone's own pairing record first, else its
 * ground station's relay-proxy
 * (`/api/v1/ground-station/relay-proxy/{peer}/api/plugins/{id}/config`), and
 * writes through the agent's native `PUT /api/plugins/{id}/config`.
 *
 * A drone reached only through the cloud has no path for this write: the
 * skill reads disabled with {@link PLUGIN_REACH_REQUIRED_REASON} and the writer
 * throws, so nothing pretends a behaviour started.
 *
 * @module skills/plugin-config-writer
 * @license GPL-3.0-only
 */

import { pluginClientForReach, resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import { usePluginConfigCache } from "@/lib/plugins/config-cache";

import {
  usePluginSkillHostStore,
  type PluginConfigWriter,
} from "./plugin-skill-host-store";

/** Disabled reason for a plugin skill on a drone with no LAN or ground-station
 * path (cloud-only reach cannot carry a plugin config write). */
export const PLUGIN_REACH_REQUIRED_REASON = "extensions.reach.lanOrGroundRequired";

/** True when a plugin config write can reach `deviceId` (LAN or relay). */
export function canWritePluginConfig(deviceId: string): boolean {
  return resolveNodeAgentReach(deviceId) !== null;
}

async function putConfig(
  deviceId: string,
  pluginId: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const reach = resolveNodeAgentReach(deviceId);
  if (!reach) return false;
  await pluginClientForReach(reach).setConfig(pluginId, key, value, "drone");
  usePluginConfigCache.getState().record(deviceId, pluginId, key, value);
  return true;
}

/** The boolean config writer the Skill Bar activate/deactivate calls. */
const configWriter: PluginConfigWriter = async ({
  droneId,
  pluginId,
  configKey,
  value,
}) => {
  if (!(await putConfig(droneId, pluginId, configKey, value))) {
    throw new Error(`no LAN or ground-station path to ${droneId}`);
  }
};

/** Install the live config writer into the host store. Idempotent. Call at the
 * cockpit / Skill-Bar mount; pair with {@link uninstallPluginConfigWriter}. */
export function installPluginConfigWriter(): void {
  usePluginSkillHostStore.getState().setPluginConfigWriter(configWriter);
}

/** Clear the live config writer (on cockpit unmount). After this, a skill
 * activation no-ops gracefully (the store returns false → the skill notifies). */
export function uninstallPluginConfigWriter(): void {
  usePluginSkillHostStore.getState().setPluginConfigWriter(null);
}

/**
 * Write a plugin's per-drone config value (a numeric follow distance, a string
 * camera id, a boolean target-action flag) over the same reach. Returns true
 * when the agent accepted it, false when the drone has no LAN or
 * ground-station path (the caller surfaces a hint). Used by the GCS plugin
 * bridge's `plugin.config.write` handler and by plugin target actions.
 */
export async function writePluginConfigValue(input: {
  droneId: string;
  pluginId: string;
  key: string;
  value: unknown;
}): Promise<boolean> {
  return putConfig(input.droneId, input.pluginId, input.key, input.value);
}
