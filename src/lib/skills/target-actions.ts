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

export type TargetActionStatus = "success" | "warning" | "error" | "info";

export interface TargetActionContext {
  target: SelectedTarget;
  /** Best-effort UI feedback (routes to a toast). */
  notify: (message: string, status?: TargetActionStatus) => void;
}

export interface TargetAction {
  /** Stable id (`builtin.designate`, `<pluginId>:follow`, …). */
  id: string;
  /** Short label. i18n TODO — hardcoded English per the cockpit convention. */
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
    notify("No local agent for this drone", "error");
    return false;
  }
  try {
    const client = new VisionAgentClient(agent.agentUrl, agent.apiKey);
    const result = await client.designate(target.cameraId, target.bbox, {
      classLabel: target.classLabel || undefined,
      confidence: target.confidence || undefined,
    });
    if (!result.designated) {
      notify("Designate rejected", "warning");
      return false;
    }
    useSelectedTargetStore.getState().setDesignated({
      ...target,
      trackId: result.trackId ?? target.trackId,
    });
    return true;
  } catch (e) {
    notify(e instanceof Error ? e.message : "Designate failed", "error");
    return false;
  }
}

/** Built-in: designate the clicked box as the vision engine's tracked target. */
const DESIGNATE_ACTION: TargetAction = {
  id: "builtin.designate",
  label: "Designate target",
  icon: resolveNamedIcon("designate"),
  source: "builtin",
  order: 10,
  defaultKey: "d",
  activate: async ({ target, notify }) => {
    if (await designateTarget(target, notify)) {
      notify("Target designated", "success");
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
): TargetAction {
  return {
    id: `${c.pluginId}:${c.localId}`,
    label: c.label,
    icon: resolveNamedIcon(c.icon ?? "designate"),
    source: "plugin",
    pluginId: c.pluginId,
    order: c.order ?? 100,
    ...(c.defaultKey ? { defaultKey: c.defaultKey } : {}),
    ...(c.appliesToClass
      ? { appliesTo: (t: SelectedTarget) => t.classLabel === c.appliesToClass }
      : {}),
    activate: async ({ target, notify }) => {
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
          notify(e instanceof Error ? e.message : "Config write failed", "error");
          return;
        }
      }
      notify(c.label, "success");
    },
  };
}
