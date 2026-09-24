/**
 * @module cmdPluginsValidators
 * @description Shared Convex value-validators for the plugin registry
 * mutations in `cmdPlugins.ts`. This module defines no registered
 * functions, so it is not part of the generated API surface; it exists
 * to keep the registry module under the file-size budget.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const sourceValidator = v.union(
  v.literal("local_file"),
  v.literal("git_url"),
  v.literal("registry"),
  v.literal("builtin"),
);

export const statusValidator = v.union(
  v.literal("installed"),
  v.literal("enabled"),
  v.literal("running"),
  v.literal("disabled"),
  v.literal("crashed"),
  v.literal("removed"),
);

export const halfValidator = v.union(v.literal("agent"), v.literal("gcs"));

export const eventTypeValidator = v.union(
  v.literal("installed"),
  v.literal("enabled"),
  v.literal("disabled"),
  v.literal("removed"),
  v.literal("started"),
  v.literal("stopped"),
  v.literal("crashed"),
  v.literal("permission_granted"),
  v.literal("permission_revoked"),
  v.literal("permission_denied"),
  v.literal("update_available"),
  v.literal("update_applied"),
  v.literal("operator_note"),
);

export const severityValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("error"),
);

/** Node profiles a contribution can be offered on. */
export const nodeProfileValidator = v.union(
  v.literal("drone"),
  v.literal("ground-station"),
  v.literal("workstation"),
  v.literal("compute"),
);

/**
 * Denormalized `gcs.contributes` slot entries recorded on the install row, so
 * the contribution producer mounts a plugin without fetching the manifest
 * each render. `section`/`after`/`setupFor` place a `node.agent.page` entry in
 * the Agent sidebar; `group` places a `node.surface` entry in the node tab
 * strip. Every placement field is optional.
 */
export const gcsContributesValidator = v.array(
  v.object({
    slot: v.string(), // PluginSlotName, e.g. "video.overlay"
    panelId: v.string(), // the contribution's manifest id
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    order: v.optional(v.number()),
    // Node profiles the entry is offered on. Absent = any profile the host
    // allows.
    profile: v.optional(v.array(nodeProfileValidator)),
    // Agent sidebar section id a `node.agent.page` joins.
    section: v.optional(v.string()),
    // Sibling page id a `node.agent.page` is placed after.
    after: v.optional(v.string()),
    // Tab-strip group a `node.surface` joins.
    group: v.optional(
      v.union(
        v.literal("status"),
        v.literal("vehicle"),
        v.literal("link"),
        v.literal("device"),
        v.literal("compute"),
      ),
    ),
    // Page id (same plugin) this `node.agent.page` renders as the Setup pane of.
    setupFor: v.optional(v.string()),
  }),
);

/** How the GCS half mounts: a sandboxed iframe, or a signer-gated inline module. */
export const gcsIsolationValidator = v.union(v.literal("iframe"), v.literal("inline"));

/**
 * Denormalized declarative plugin-parameter contributions
 * (`gcs.contributes.parameters[]`), recorded on the install row so the
 * native parameter panel renders without re-fetching the manifest. Mirrors
 * the `PluginParameter` shape in
 * `src/lib/plugins/parameters/schema.ts`. The nested `schema` keeps only the
 * JSON-Schema subset the parameter contract supports; `ui` is the presentation
 * layer. Stored as-is, validated GCS-side at parse time. Additive-optional on
 * the install row, so older rows omit it and the panel simply renders nothing.
 */
export const gcsParametersValidator = v.array(
  v.object({
    key: v.string(),
    schema: v.object({
      type: v.union(
        v.literal("number"),
        v.literal("integer"),
        v.literal("boolean"),
        v.literal("string"),
      ),
      minimum: v.optional(v.number()),
      maximum: v.optional(v.number()),
      step: v.optional(v.number()),
      enum: v.optional(
        v.array(v.union(v.string(), v.number(), v.boolean())),
      ),
      pattern: v.optional(v.string()),
      default: v.optional(v.union(v.string(), v.number(), v.boolean())),
    }),
    binding: v.optional(
      v.union(
        v.literal("plugin.config"),
        v.literal("engine.detector"),
        v.literal("agent.config"),
      ),
    ),
    ui: v.optional(
      v.object({
        widget: v.optional(v.string()),
        label: v.optional(v.string()),
        group: v.optional(v.string()),
        help: v.optional(v.string()),
        task: v.optional(v.string()),
        order: v.optional(v.number()),
        visible_if: v.optional(
          v.object({
            key: v.string(),
            equals: v.union(v.string(), v.number(), v.boolean()),
          }),
        ),
      }),
    ),
  }),
);

/**
 * Denormalized `gcs.contributes.skills[]` contributions recorded on the install
 * row, so the cockpit Skill Bar mounts a plugin skill for a cloud operator
 * without re-fetching the manifest. Mirrors the parsed skill shape the
 * `use-drone-skill-contributions` hook reads (`configKey` = activation.config_key,
 * `stateTopic` = state.topic). Additive-optional on the install row.
 */
export const flightSkillsValidator = v.array(
  v.object({
    id: v.string(),
    label: v.optional(v.string()),
    icon: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("behavior"),
        v.literal("camera"),
        v.literal("navigation"),
        v.literal("utility"),
      ),
    ),
    toggle: v.optional(v.boolean()),
    confirm: v.optional(v.boolean()),
    armRequirement: v.optional(
      v.union(
        v.literal("any"),
        v.literal("armed"),
        v.literal("disarmed"),
        v.null(),
      ),
    ),
    configKey: v.optional(v.string()),
    stateTopic: v.optional(v.string()),
    defaultBinding: v.optional(
      v.object({
        key: v.optional(v.union(v.string(), v.null())),
        gamepadButton: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  }),
);

/**
 * Denormalized `gcs.contributes.target_actions[]` contributions recorded on the
 * install row, so the cockpit click-a-target popup lists a plugin's target
 * actions for a cloud operator. Mirrors the shape the `use-drone-target-actions`
 * hook reads. Additive-optional on the install row.
 */
export const targetActionsValidator = v.array(
  v.object({
    id: v.string(),
    label: v.optional(v.string()),
    icon: v.optional(v.string()),
    order: v.optional(v.number()),
    appliesToClass: v.optional(v.string()),
    designate: v.optional(v.boolean()),
    configKey: v.optional(v.string()),
    configValue: v.optional(v.boolean()),
    defaultKey: v.optional(v.string()),
  }),
);
