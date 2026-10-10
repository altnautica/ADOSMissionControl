/**
 * @module skills/target-actions
 * @description The TARGET-ACTION registry: actions that operate on a clicked
 * detection (the {@link SelectedTarget}). One shape for built-in host actions
 * AND plugin-contributed ones, held in one registry and shown in one popup —
 * the same "built-in == plugin" contribution pattern the Skill Bar uses.
 *
 * When the operator clicks a bounding box in the cockpit overlay, the host
 * resolves the applicable actions for that target and pops them up; picking one
 * runs it with the target as its argument. An action can also be surfaced as a
 * bindable Skill so a hotkey fires it on the current selection (that binding is
 * layered on top of this registry).
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { VisionAgentClient } from "@/lib/agent/vision-client";
import { isDemoMode } from "@/lib/utils";
import {
  useSelectedTargetStore,
  type SelectedTarget,
} from "@/stores/selected-target-store";
import { isReservedChord } from "./chord";
import {
  PLUGIN_CONFIRM_POLICY,
  type DroneSkillContribution,
} from "./plugin-skills";
import { buildSkillContextFor } from "./registry";
import type { ArmRequirement, SkillContext } from "./types";

export type TargetActionStatus = "success" | "warning" | "error" | "info";

export interface TargetActionContext {
  target: SelectedTarget;
  /** Best-effort UI feedback (routes to a toast). `message` is an i18n key or
   * literal text; the host resolves a key and shows a literal as given. */
  notify: (message: string, status?: TargetActionStatus) => void;
}

export interface TargetAction {
  /** Stable id (`builtin.designate`, `<pluginId>:follow`, …). */
  id: string;
  /** Short label: an i18n key (resolved by the popup) or a literal plugin label. */
  label: string;
  icon?: LucideIcon;
  source: "builtin" | "plugin";
  pluginId?: string;
  /** Order in the popup (lower first). Default 100. */
  order?: number;
  /** A single-key hotkey that fires this action on the CURRENTLY-SELECTED target
   * (a lower-case key, e.g. "d"). While a target is selected in the cockpit,
   * pressing it runs the action on that target. Absent = popup-only. */
  defaultKey?: string;
  /** Whether this action applies to the given target (class / track predicate).
   * Absent = applies to every target. */
  appliesTo?: (target: SelectedTarget) => boolean;
  /** Run the action on the selected target. */
  activate: (ctx: TargetActionContext) => void | Promise<void>;
}

interface TargetActionRegistryState {
  actions: TargetAction[];
  /** Register (or replace by id) an action. */
  register: (action: TargetAction) => void;
  /** Remove an action by id. */
  unregister: (id: string) => void;
}

export const useTargetActionRegistry = create<TargetActionRegistryState>()(
  (set) => ({
    actions: [],
    register: (action) =>
      set((s) => ({
        actions: [...s.actions.filter((a) => a.id !== action.id), action],
      })),
    unregister: (id) =>
      set((s) => ({ actions: s.actions.filter((a) => a.id !== id) })),
  }),
);

/** The actions applicable to a target, popup order. */
export function resolveTargetActions(target: SelectedTarget): TargetAction[] {
  return useTargetActionRegistry
    .getState()
    .actions.filter((a) => !a.appliesTo || a.appliesTo(target))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Whether designate can reach this drone's vision engine. It needs a direct
 * (LAN) agent link: the cloud relay does not carry the designate call. */
function canDesignate(target: SelectedTarget): boolean {
  if (isDemoMode()) return true;
  const deviceId = deviceIdFromNodeId(target.droneId) ?? target.droneId;
  return resolveLocalAgentForDrone(deviceId) != null;
}

/**
 * DESIGNATE a target: lock the vision engine's tracker onto the clicked box so
 * any consumer (a Follow-Me plugin, a gimbal, …) follows what is locked. Shared
 * by the built-in action AND plugin target actions that follow a designated
 * subject. Notifies only on failure; returns whether the lock took. On the
 * engine's acknowledgement the target becomes the cockpit's designated target,
 * carrying the track id the engine locked. Demo mode acknowledges without a
 * network call.
 */
export async function designateTarget(
  target: SelectedTarget,
  notify: (message: string, status?: TargetActionStatus) => void,
): Promise<boolean> {
  if (isDemoMode()) {
    useSelectedTargetStore.getState().setDesignated(target);
    return true;
  }
  const deviceId = deviceIdFromNodeId(target.droneId) ?? target.droneId;
  const agent = resolveLocalAgentForDrone(deviceId);
  if (!agent) {
    notify(
      "vision.targetActions.designateNeedsLan",
      "error",
    );
    return false;
  }
  try {
    const client = new VisionAgentClient(agent.agentUrl, agent.apiKey);
    const result = await client.designate(target.cameraId, target.bbox, {
      classLabel: target.classLabel || undefined,
      confidence: target.confidence || undefined,
    });
    if (!result.designated) {
      notify("vision.targetActions.designateRejected", "warning");
      return false;
    }
    useSelectedTargetStore.getState().setDesignated({
      ...target,
      trackId: result.trackId ?? target.trackId,
    });
    return true;
  } catch (e) {
    notify(e instanceof Error ? e.message : "vision.targetActions.designateFailed", "error");
    return false;
  }
}

/** Built-in: designate the clicked box as the vision engine's tracked target. */
const DESIGNATE_ACTION: TargetAction = {
  id: "builtin.designate",
  label: "vision.targetActions.designate",
  icon: resolveNamedIcon("designate"),
  source: "builtin",
  order: 10,
  defaultKey: "d",
  // Offered only where it can work, so a relay-linked drone never shows an
  // action that always fails.
  appliesTo: canDesignate,
  activate: async ({ target, notify }) => {
    if (await designateTarget(target, notify)) {
      notify("vision.targetActions.designated", "success");
    }
  },
};

let builtinsRegistered = false;

/** Register the built-in target actions once (idempotent). */
export function registerBuiltinTargetActions(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  useTargetActionRegistry.getState().register(DESIGNATE_ACTION);
}

// ── Plugin-contributed target actions ──────────────────────────────────────

/** A plugin's declarative target-action, denormalized off its install row (the
 * same additive shape as the flight-skill denorm). It runs host-side: optionally
 * designate the clicked target, then write a per-drone plugin config key so the
 * plugin's agent half acts on the (now locked) subject — no plugin iframe needed. */
export interface DroneTargetActionContribution {
  installId: string;
  pluginId: string;
  localId: string;
  label: string;
  /** lucide icon name (best-effort; falls back to the target icon). */
  icon?: string;
  order?: number;
  /** Only applies to a detection of this class (e.g. "person"). Absent = any. */
  appliesToClass?: string;
  /** Designate (lock) the target before writing config. */
  designate?: boolean;
  /** Per-drone plugin config key to write on activate (e.g. "active"). */
  configKey?: string;
  /** Value written to `configKey` (default true). */
  configValue?: boolean;
  /** Default hotkey for the selected target. */
  defaultKey?: string;
  /** Open the host confirm before acting. Inherited from the same plugin's
   * skill bound to the same config key (see {@link inheritSkillGates}). */
  confirm?: boolean;
  /** Arm state the action requires. Inherited like `confirm`. */
  armRequirement?: ArmRequirement;
}

/**
 * Give each target action the confirm and arm gates of the plugin skill that
 * writes the same config key. A target action that flips the same switch as a
 * skill (Follow-Me's `active`) is the same behaviour reached from a different
 * surface, so it must not bypass the gates the skill enforces.
 */
export function inheritSkillGates(
  actions: readonly DroneTargetActionContribution[],
  skills: readonly DroneSkillContribution[],
): DroneTargetActionContribution[] {
  return actions.map((action) => {
    if (!action.configKey) return action;
    const skill = skills.find(
      (s) => s.pluginId === action.pluginId && s.configKey === action.configKey,
    );
    if (!skill) return action;
    return {
      ...action,
      confirm: skill.confirm,
      armRequirement: skill.armRequirement ?? "any",
    };
  });
}

/** The writer a plugin target-action uses to flip the plugin's per-drone config
 * (resolves the LAN agent + PUT /api/plugins/{id}/config). Injected so it is
 * testable and demo-safe. */
export type PluginConfigWrite = (
  pluginId: string,
  deviceId: string,
  configKey: string,
  value: unknown,
) => Promise<void>;

/**
 * Build a {@link TargetAction} from a plugin contribution. Same shape + registry
 * + popup as the built-in actions (guideline 2). Activate: optionally designate
 * the target, then write the plugin's config so its agent half follows.
 */
export function buildPluginTargetAction(
  c: DroneTargetActionContribution,
  droneId: string,
  writeConfig: PluginConfigWrite,
  contextFor: (droneId: string) => SkillContext = buildSkillContextFor,
): TargetAction {
  // A target-action hotkey never shadows a chord the app owns.
  const defaultKey =
    c.defaultKey && !isReservedChord(c.defaultKey.toLowerCase())
      ? c.defaultKey
      : undefined;
  return {
    id: `${c.pluginId}:${c.localId}`,
    label: c.label,
    icon: resolveNamedIcon(c.icon ?? "designate"),
    source: "plugin",
    pluginId: c.pluginId,
    order: c.order ?? 100,
    ...(defaultKey ? { defaultKey } : {}),
    ...(c.appliesToClass
      ? { appliesTo: (t: SelectedTarget) => t.classLabel === c.appliesToClass }
      : {}),
    activate: async ({ target, notify }) => {
      const armReq = c.armRequirement ?? "any";
      if (armReq !== "any" || c.confirm) {
        const ctx = contextFor(droneId);
        // Same arm gate and reasons as the skill activation pipeline. An
        // unknown arm state satisfies neither requirement.
        if (armReq !== "any" && ctx.armState !== armReq) {
          ctx.notify(
            ctx.armState === "unknown"
              ? "skills.reason.noFcLink"
              : armReq === "armed"
                ? "skills.reason.notArmed"
                : "skills.reason.alreadyArmed",
            "warning",
          );
          return;
        }
        if (c.confirm && !(await ctx.confirm(PLUGIN_CONFIRM_POLICY))) return;
      }
      if (c.designate) {
        const ok = await designateTarget(target, notify);
        if (!ok) return;
      }
      if (c.configKey) {
        const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
        try {
          await writeConfig(
            c.pluginId,
            deviceId,
            c.configKey,
            c.configValue ?? true,
          );
        } catch (e) {
          notify(
            e instanceof Error ? e.message : "vision.targetActions.configWriteFailed",
            "error",
          );
          return;
        }
      }
      notify(c.label, "success");
    },
  };
}
