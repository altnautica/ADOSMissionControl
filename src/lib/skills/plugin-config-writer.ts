"use client";

/**
 * The live config-write seam for plugin skills + plugin iframe settings.
 *
 * A plugin skill's activate/deactivate (and a plugin's per-drone settings
 * inputs) flip the plugin's per-drone config; the plugin reads that config
 * each tick from the LIVE store in the running `ados-plugin-host`. This module
 * is the writer the host store (`plugin-skill-host-store`) calls: it resolves
 * the LAN-paired agent for the drone (local-first, from
 * `local-nodes-store`) and writes through the agent's native
 * `PUT /api/plugins/{id}/config` (→ the daemon's control socket → the live
 * store). No Convex round-trip; the cloud mirror is a separate, later path.
 *
 * When a drone has no LAN seam (e.g. a cloud-only drone before the deferred
 * cloud mirror lands), the writer throws — the dispatcher swallows it and the
 * skill stays in its plugin-reported state (HUD honesty over a fake-active
 * bar).
 *
 * @module skills/plugin-config-writer
 * @license GPL-3.0-only
 */

import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";
import { usePluginConfigCache } from "@/lib/plugins/config-cache";

import {
  usePluginSkillHostStore,
  type PluginConfigWriter,
} from "./plugin-skill-host-store";

/** The boolean config writer the Skill Bar activate/deactivate calls. */
const localConfigWriter: PluginConfigWriter = async ({
  droneId,
  pluginId,
  configKey,
  value,
}) => {
  const agent = resolveLanAgent(droneId);
  if (!agent) {
    throw new Error(`no local agent seam for ${droneId}`);
  }
  const client = new PluginAgentClient(agent.agentUrl, agent.apiKey);
  await client.setConfig(pluginId, configKey, value, "drone");
  usePluginConfigCache.getState().record(droneId, pluginId, configKey, value);
};

/** Install the live config writer into the host store. Idempotent. Call at the
 * cockpit / Skill-Bar mount; pair with {@link uninstallPluginConfigWriter}. */
export function installPluginConfigWriter(): void {
  usePluginSkillHostStore.getState().setPluginConfigWriter(localConfigWriter);
}

/** Clear the live config writer (on cockpit unmount). After this, a skill
 * activation no-ops gracefully (the store returns false → the skill notifies). */
export function uninstallPluginConfigWriter(): void {
  usePluginSkillHostStore.getState().setPluginConfigWriter(null);
}

/**
 * Write a plugin's per-drone config from its iframe settings (a numeric follow
 * distance, a string camera id, a bool gimbal-point) over the same LAN agent
 * path. Returns true when a LAN seam accepted it, false when the drone has no
 * LAN agent (the caller surfaces a hint). Used by the GCS plugin bridge's
 * `plugin.config.write` handler, the iframe counterpart to the skill toggle.
 */
export async function writePluginConfigValue(input: {
  droneId: string;
  pluginId: string;
  key: string;
  value: unknown;
}): Promise<boolean> {
  const agent = resolveLanAgent(input.droneId);
  if (!agent) return false;
  const client = new PluginAgentClient(agent.agentUrl, agent.apiKey);
  await client.setConfig(input.pluginId, input.key, input.value, "drone");
  usePluginConfigCache
    .getState()
    .record(input.droneId, input.pluginId, input.key, input.value);
  return true;
}
