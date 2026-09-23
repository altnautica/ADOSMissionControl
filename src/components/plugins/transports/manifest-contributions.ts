/**
 * @module manifest-contributions
 * @description Parsers for the manifest's `gcs.contributes` blocks that the
 * host renders natively: flight skills, cockpit target actions, and the
 * slot-bearing panels, overlays and notification channels.
 *
 * @license GPL-3.0-only
 */

import { PLUGIN_SLOTS, type PluginSlotName } from "@/lib/plugins/types";

import type {
  ParsedSkillContribution,
  ParsedSlotContribution,
  ParsedTargetActionContribution,
} from "./manifest-types";
import { isObject, num, str } from "./manifest-values";

/** Map a manifest skill `category` to one of the four recognized values,
 * defaulting unknown values to `behavior` so a forward-compatible manifest
 * never drops a skill on an unrecognized category. */
function normaliseSkillCategory(v: unknown): ParsedSkillContribution["category"] {
  const s = (str(v) ?? "").toLowerCase();
  if (s === "behavior" || s === "camera" || s === "navigation" || s === "utility") {
    return s;
  }
  return "behavior";
}

/** Map a manifest skill `arm_requirement` to one of the recognized values
 * or null (treated as "any" downstream). */
function normaliseArmRequirement(
  v: unknown,
): ParsedSkillContribution["armRequirement"] {
  const s = (str(v) ?? "").toLowerCase();
  if (s === "any" || s === "armed" || s === "disarmed") return s;
  return null;
}

/**
 * Parse the `gcs.contributes.skills[]` block. Each entry contributes a
 * flight Skill to the cockpit Skill Bar. Only entries whose `activation.via`
 * is `config` and `state.via` is `event` are honored in v1; anything else is
 * dropped with a console warning (forward-compatible, never throws). Missing
 * optional fields stay undefined.
 */
export function parseSkillContributions(
  v: unknown,
): ParsedSkillContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedSkillContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const id = str(entry.id);
    if (!id) continue;

    const activation = isObject(entry.activation) ? entry.activation : null;
    const state = isObject(entry.state) ? entry.state : null;
    const activationVia = str(activation?.via);
    const stateVia = str(state?.via);
    const configKey = str(activation?.config_key ?? activation?.configKey);
    const stateTopic = str(state?.topic);

    // v1 honors only the config-write activation + event-read state path.
    if (
      activationVia !== "config" ||
      stateVia !== "event" ||
      !configKey ||
      !stateTopic
    ) {
      if (typeof console !== "undefined") {
        console.warn(
          `Plugin skill "${id}" dropped: v1 supports only activation.via=config + state.via=event with config_key and topic set`,
        );
      }
      continue;
    }

    const row: ParsedSkillContribution = {
      id,
      label: str(entry.label) ?? id,
      icon: str(entry.icon) ?? "Sparkles",
      category: normaliseSkillCategory(entry.category),
      toggle: entry.toggle === true,
      confirm: entry.confirm === true,
      armRequirement: normaliseArmRequirement(
        entry.arm_requirement ?? (entry as Record<string, unknown>).armRequirement,
      ),
      activation: { via: "config", configKey },
      state: { via: "event", topic: stateTopic },
    };

    const binding = isObject(entry.default_binding)
      ? entry.default_binding
      : isObject((entry as Record<string, unknown>).defaultBinding)
        ? ((entry as Record<string, unknown>).defaultBinding as Record<
            string,
            unknown
          >)
        : null;
    if (binding) {
      const key = str(binding.key);
      const gamepadButton = num(
        binding.gamepad_button ?? (binding as Record<string, unknown>).gamepadButton,
      );
      const defaultBinding: NonNullable<
        ParsedSkillContribution["defaultBinding"]
      > = {};
      if (key !== undefined) defaultBinding.key = key;
      if (gamepadButton !== undefined) {
        defaultBinding.gamepadButton = gamepadButton;
      }
      if (defaultBinding.key !== undefined || defaultBinding.gamepadButton !== undefined) {
        row.defaultBinding = defaultBinding;
      }
    }

    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parse the `gcs.contributes.target_actions[]` block (also accepts the
 * camelCase `targetActions`). Each entry is a cockpit target action the plugin
 * adds to the click-a-target popup: the host owns the overlay + the selection,
 * and the plugin only declares the action's label, hotkey, class filter, and
 * the per-drone config write it triggers on the selected target. Each entry
 * needs a stable `id`; every other field is optional and default-absent.
 * Forward-compatible: an entry without an id is dropped, never thrown.
 */
export function parseTargetActionContributions(
  v: unknown,
): ParsedTargetActionContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedTargetActionContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const id = str(entry.id);
    if (!id) continue;
    const row: ParsedTargetActionContribution = { id };
    const label = str(entry.label);
    const icon = str(entry.icon);
    const order = num(entry.order);
    const appliesToClass = str(
      entry.applies_to_class ?? (entry as Record<string, unknown>).appliesToClass,
    );
    const configKey = str(
      entry.config_key ?? (entry as Record<string, unknown>).configKey,
    );
    const defaultKey = str(
      entry.default_key ?? (entry as Record<string, unknown>).defaultKey,
    );
    if (label !== undefined) row.label = label;
    if (icon !== undefined) row.icon = icon;
    if (order !== undefined) row.order = order;
    if (appliesToClass !== undefined) row.appliesToClass = appliesToClass;
    if (typeof entry.designate === "boolean") row.designate = entry.designate;
    if (configKey !== undefined) row.configKey = configKey;
    const configValue =
      entry.config_value ?? (entry as Record<string, unknown>).configValue;
    if (typeof configValue === "boolean") row.configValue = configValue;
    if (defaultKey !== undefined) row.defaultKey = defaultKey;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** Canonical UI-slot set used to reject bogus slots before they ever
 * reach the install row. Mirrors the producer's own guard so a
 * persisted contribution always names a slot the host can mount. */
const KNOWN_SLOTS = new Set<string>(PLUGIN_SLOTS);
function isKnownSlot(slot: string): slot is PluginSlotName {
  return KNOWN_SLOTS.has(slot);
}

/**
 * Walk one slot-bearing `gcs.contributes.*` array and append a parsed
 * row per entry. `panels` entries carry their own `slot`; `overlays`
 * and `notifications` entries may omit it, so `defaultSlot` supplies
 * the slot those arrays imply by definition (a video overlay / a
 * notification channel). Entries without an `id`, or whose resolved
 * slot is not a known `PluginSlotName`, are dropped — a bogus slot
 * must never be persisted to the install row.
 */
function collectSlotContributions(
  source: unknown,
  defaultSlot: PluginSlotName | undefined,
  into: ParsedSlotContribution[],
): void {
  if (!Array.isArray(source)) return;
  for (const entry of source) {
    if (!isObject(entry)) continue;
    const panelId = str(entry.id);
    if (!panelId) continue;
    const slot = str(entry.slot) ?? defaultSlot;
    if (!slot || !isKnownSlot(slot)) continue;
    const row: ParsedSlotContribution = { slot, panelId };
    const title = str(entry.title);
    const icon = str(entry.icon);
    const order = num(entry.order);
    if (title !== undefined) row.title = title;
    if (icon !== undefined) row.icon = icon;
    if (order !== undefined) row.order = order;
    into.push(row);
  }
}

/**
 * Parse the slot contributions out of `gcs.contributes` — the
 * `panels`, `overlays`, and `notifications` arrays. Each becomes a
 * `{ slot, panelId, title?, icon?, order? }` row matching the
 * `recordInstall` `gcsContributes` arg + the producer's row shape, so
 * an installed plugin's iframe-bearing slots mount once the row lands.
 * Skills are parsed separately (`parseSkillContributions`) because they
 * are not iframe slots. Returns undefined when no valid entry is found.
 */
export function parseSlotContributions(
  contributes: unknown,
): ParsedSlotContribution[] | undefined {
  if (!isObject(contributes)) return undefined;
  const out: ParsedSlotContribution[] = [];
  // `panels` declare their own slot per entry; `overlays` are video
  // overlays and `notifications` are notification channels by
  // definition, so supply those slots as the default.
  collectSlotContributions(contributes.panels, undefined, out);
  collectSlotContributions(contributes.overlays, "video.overlay", out);
  collectSlotContributions(
    contributes.notifications,
    "notification.channel",
    out,
  );
  return out.length > 0 ? out : undefined;
}
