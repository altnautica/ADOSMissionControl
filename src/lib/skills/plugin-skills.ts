/**
 * Build a registry {@link Skill} from a plugin's `flight.skill` contribution.
 *
 * A plugin skill is the same shape as a built-in skill, with `source:"plugin"`
 * and an id namespaced to `${pluginId}:${localId}`. Its `activate`/
 * `deactivate` flip the plugin's per-drone config flag through the host config
 * writer seam (the v1 `activation.via: config` path); its `getState` reads the
 * latest cached plugin state event for the skill's topic (the v1
 * `state.via: event` path) so the bar reflects the plugin's reported state, not
 * optimistic GCS state. The registry's existing arm/confirm/idempotency gates
 * run for plugin skills identically to built-ins.
 *
 * @module skills/plugin-skills
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type {
  ArmRequirement,
  ConfirmPolicy,
  Skill,
  SkillCategory,
  SkillContext,
  SkillState,
} from "./types";
import {
  usePluginSkillHostStore,
  writePluginConfig,
} from "./plugin-skill-host-store";

/** The node a skill context addresses, as its bare device id. The skill bar
 * hands the drone-manager selection id (`node:<deviceId>`); plugin state and
 * the plugin config writer are keyed by the bare id the node reports. */
function pluginDeviceId(ctx: Pick<SkillContext, "droneId">): string {
  return deviceIdFromNodeId(ctx.droneId) ?? ctx.droneId;
}

/** One resolved plugin-skill contribution for a drone. Manifest-derived. */
export interface DroneSkillContribution {
  /** Install row id from `cmd_pluginInstalls._id`. Stable per drone. */
  installId: string;
  /** Reverse-DNS plugin id from the manifest. */
  pluginId: string;
  /** Local skill id within the plugin (unique per plugin). */
  localId: string;
  /** i18n key or literal label. */
  label: string;
  /** lucide-react icon name. */
  icon: string;
  /** Manifest category (mapped to the registry SkillCategory at build). */
  category: "behavior" | "camera" | "navigation" | "utility";
  /** Whether the skill is a toggle (vs one-shot). */
  toggle: boolean;
  /** When true the host builds a generic confirm policy from i18n keys. */
  confirm: boolean;
  /** Arm requirement gate; null means "any". */
  armRequirement: "any" | "armed" | "disarmed" | null;
  /** Plugin per-drone config flag the activation flips. */
  configKey: string;
  /** Topic the plugin reports its state on. */
  stateTopic: string;
  /** Suggested default binding from the manifest. */
  defaultBinding?: { key?: string | null; gamepadButton?: number | null };
}

/**
 * Map a manifest skill category to the registry's SkillCategory enum. The
 * registry's CATEGORY_ORDER indexes every key of SkillCategory, so a plugin
 * category must land on one of `behavior | camera | safety | flight`. We map
 * `navigation`/`utility` to `behavior` (the closest neutral bucket) and never
 * place a plugin skill in `flight` or `safety` (reserved for built-in flight
 * commands and high-consequence safety actions).
 */
export function mapSkillCategory(
  category: DroneSkillContribution["category"],
): SkillCategory {
  switch (category) {
    case "camera":
      return "camera";
    case "behavior":
    case "navigation":
    case "utility":
    default:
      return "behavior";
  }
}

/** Namespaced registry id for a plugin skill. */
export function pluginSkillId(pluginId: string, localId: string): string {
  return `${pluginId}:${localId}`;
}

/**
 * Generic confirm policy for a plugin skill, built from host i18n keys so a
 * plugin does not need to ship GCS translations. The confirm host resolves
 * the keys. Plugin behaviors are not destructive built-ins, so the policy
 * uses the `primary` variant with no typed phrase.
 */
const PLUGIN_CONFIRM_POLICY: ConfirmPolicy = {
  title: "skills.plugin.confirm.title",
  message: "skills.plugin.confirm.message",
  confirmLabel: "skills.plugin.confirm.button",
  variant: "primary",
};

/**
 * Map a cached plugin state event to a registry SkillState. No cached event
 * (the plugin has not reported yet) reads as idle so the bar shows the skill
 * available rather than guessing it active.
 */
function readPluginState(droneId: string, topic: string): SkillState {
  const event = usePluginSkillHostStore
    .getState()
    .getPluginSkillState(droneId, topic);
  if (!event) return { kind: "idle" };
  if (event.state === "active") {
    return event.badge ? { kind: "active", badge: event.badge } : { kind: "active" };
  }
  if (event.state === "disabled") {
    return {
      kind: "disabled",
      reason: event.reason ?? "skills.plugin.reason.unavailable",
    };
  }
  return { kind: "idle" };
}

/**
 * Build a registry Skill from a per-drone plugin contribution. The returned
 * skill is keyed to `droneId`: its closures read/write only that drone's
 * config + state, so the host registers one Skill per (drone, contribution).
 */
export function buildPluginSkill(c: DroneSkillContribution): Skill {
  const id = pluginSkillId(c.pluginId, c.localId);
  const armRequirement: ArmRequirement =
    c.armRequirement && c.armRequirement !== null ? c.armRequirement : "any";

  const skill: Skill = {
    id,
    label: c.label,
    icon: c.icon,
    category: mapSkillCategory(c.category),
    source: "plugin",
    pluginId: c.pluginId,
    toggle: c.toggle,
    armRequirement,
    getState: (ctx) => readPluginState(pluginDeviceId(ctx), c.stateTopic),
    activate: async (ctx) => {
      const ok = await writePluginConfig({
        droneId: pluginDeviceId(ctx),
        pluginId: c.pluginId,
        configKey: c.configKey,
        value: true,
      });
      if (!ok) ctx.notify("skills.plugin.reason.noConfigSeam", "warning");
    },
  };

  if (c.confirm) {
    skill.confirm = PLUGIN_CONFIRM_POLICY;
  }

  if (c.toggle) {
    skill.deactivate = async (ctx) => {
      const ok = await writePluginConfig({
        droneId: pluginDeviceId(ctx),
        pluginId: c.pluginId,
        configKey: c.configKey,
        value: false,
      });
      if (!ok) ctx.notify("skills.plugin.reason.noConfigSeam", "warning");
    };
  }

  return skill;
}
