/**
 * @module manifest-types
 * @description The typed shape the client-side manifest parser produces
 * from a plugin's `manifest.yaml`.
 *
 * @license GPL-3.0-only
 */

import type { ParsedParameterContribution } from "@/lib/plugins/parameters/parse";
import type {
  ParsedMapOverlayContribution,
  ParsedMissionTemplateContribution,
  ParsedModelContribution,
  ParsedSettingsContribution,
  ParsedTabContribution,
  ParsedToolContribution,
} from "@/lib/plugins/contributions/parse";
import type {
  GcsContributeRow,
  GcsIsolation,
  PluginHalf,
  PluginSlotName,
} from "@/lib/plugins/types";

export interface ParsedHardwareRequirements {
  cameras?: string;
  fcFirmware?: string;
  boards?: string[];
  optional?: string[];
}

export interface ParsedResourceImpact {
  cpuPercentPeak?: number;
  outputRateHz?: number;
  ramMb?: number;
  pids?: number;
  startupTimeSeconds?: number;
}

export interface ParsedFcParameter {
  param: string;
  note?: string;
  value?: string;
}

export interface ParsedRequiredFcParameters {
  ardupilot?: ParsedFcParameter[];
  px4?: ParsedFcParameter[];
  inav?: ParsedFcParameter[];
}

export interface ParsedScreenshot {
  url: string;
  caption?: string;
}

/**
 * One `gcs.contributes.skills[]` entry: a flight Skill the plugin
 * contributes to the cockpit Skill Bar. The registry namespaces the id to
 * `${pluginId}:${id}`. `activation.via` and `state.via` are fixed to the v1
 * config-write / event-read contract; entries with any other transport are
 * dropped at parse time.
 */
export interface ParsedSkillContribution {
  /** Unique within the plugin. */
  id: string;
  /** i18n key (resolved under the plugin's namespace) or a literal label. */
  label: string;
  /** lucide-react icon name. */
  icon: string;
  /** Category, mapped to the registry's SkillCategory at register time. */
  category: "behavior" | "camera" | "navigation" | "utility";
  /** Whether the skill is an on/off toggle (vs a one-shot). */
  toggle: boolean;
  /** When true, the host builds a confirm policy before activation. */
  confirm: boolean;
  /** Arm requirement gate; null means "any". */
  armRequirement: "any" | "armed" | "disarmed" | null;
  /** Suggested default keyboard/gamepad binding. */
  defaultBinding?: { key?: string | null; gamepadButton?: number | null };
  /** Activation transport — v1 is always config-write. */
  activation: { via: "config"; configKey: string };
  /** State transport — v1 is always an event-topic read. */
  state: { via: "event"; topic: string };
}

/**
 * One `gcs.contributes.target_actions[]` entry: a cockpit target action the
 * plugin adds to the click-a-target popup. The registry namespaces the id to
 * `${pluginId}:${id}`. Every field but `id` is optional; the persisted install
 * row carries these so a cloud operator's popup lists the action beside the
 * built-ins (matching the local-first path).
 */
export interface ParsedTargetActionContribution {
  /** Unique within the plugin. */
  id: string;
  /** i18n key or literal label shown in the popup. */
  label?: string;
  /** lucide-react icon name. */
  icon?: string;
  /** Sort hint in the popup (lower first). */
  order?: number;
  /** Only offered on a detection of this class (e.g. "person"). Absent = any. */
  appliesToClass?: string;
  /** Designate (lock) the target before writing config. */
  designate?: boolean;
  /** Per-drone plugin config key written on activate. */
  configKey?: string;
  /** Value written to `configKey`. */
  configValue?: boolean;
  /** Default single-key hotkey for the selected target. */
  defaultKey?: string;
}

/**
 * One slot-bearing `gcs.contributes` entry (a panel, overlay, notification
 * channel, Agent-sidebar page or node surface). The host mounts the plugin's
 * `panelId` into `slot`. Shape matches the `recordInstall` `gcsContributes`
 * arg and the contribution producer's row field; the placement fields are
 * set only for the node page slots.
 */
export type ParsedSlotContribution = GcsContributeRow & {
  /** A validated, host-known UI slot the contribution mounts into. */
  slot: PluginSlotName;
};

export interface ParsedManifest {
  pluginId: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  signerId?: string;
  /** A shared-vocabulary named icon declared at the manifest top level. */
  icon?: string;
  /** Public homepage / source repository URL declared in the manifest. */
  homepageUrl?: string;
  halves: ReadonlyArray<PluginHalf>;
  permissions: ReadonlyArray<{
    id: string;
    required: boolean;
    /** Which half declared this permission (`agent` or `gcs`). Set when
     * the parser walked an indented `agent.permissions:` or
     * `gcs.permissions:` block. Legacy top-level `permissions:` entries
     * leave this undefined. */
    half?: PluginHalf;
  }>;
  /** `gcs.entrypoint`: the archive path of the GCS half's module. */
  gcsEntrypoint?: string;
  /** How the GCS half mounts: a sandboxed iframe (the default) or a trusted
   * in-page module. Undefined when the plugin has no GCS half. */
  gcsIsolation?: GcsIsolation;
  /** Long-form description from a YAML block literal. Renders as a
   * paragraph in the install-modal summary. */
  descriptionLong?: string;
  /** Bullet list of feature copy the modal renders alongside the
   * permission summary. */
  features?: string[];
  /** Hardware-side requirements surfaced as a card in the modal. */
  hardwareRequirements?: ParsedHardwareRequirements;
  /** Forecast runtime impact. Pure copy; the supervisor enforces the
   * hard limits declared under ``agent.resources``. */
  resourceImpact?: ParsedResourceImpact;
  /** Per-firmware parameter hints the operator should set after install. */
  requiredFcParameters?: ParsedRequiredFcParameters;
  /** Telemetry topic paths the plugin will publish once running. */
  telemetryFields?: string[];
  /** Public-docs URL for the plugin overview. https:// only. */
  documentationUrl?: string;
  /** Screenshot URLs rendered as a gallery in the modal. Absent until
   * we host real images. */
  screenshots?: ParsedScreenshot[];
  /** Flight skills the GCS half contributes to the cockpit Skill Bar. */
  contributesSkills?: ParsedSkillContribution[];
  /** Cockpit target actions the GCS half adds to the click-a-target popup. */
  contributesTargetActions?: ParsedTargetActionContribution[];
  /** Slot contributions (panels / overlays / notifications) the GCS
   * half mounts as sandboxed iframes. Fed to `recordInstall` as the
   * `gcsContributes` arg so the contribution producer can mount them. */
  contributesSlots?: ParsedSlotContribution[];
  /** Declarative JSON-Schema parameters the GCS renders natively in the
   * plugin's settings panel (and the cockpit quick-settings drawer).
   * Validated + parse-dropped per entry; undefined when none declared. */
  contributesParameters?: ParsedParameterContribution[];
  /** Node-detail tabs the GCS mounts on a node's detail panel (the
   * `node.detail.tab` slot), optionally narrowed by node profile. */
  contributesTabs?: ParsedTabContribution[];
  /** Settings sections the GCS renders in the plugin's settings panel, each
   * holding native declarative parameters. */
  contributesSettings?: ParsedSettingsContribution[];
  /** Model registrations the plugin contributes to the vision model catalog,
   * with per-board variants. */
  contributesModels?: ParsedModelContribution[];
  /** Mission templates the plugin contributes to the planner. */
  contributesMissionTemplates?: ParsedMissionTemplateContribution[];
  /** Map overlays the plugin contributes to the map surface. */
  contributesMapOverlays?: ParsedMapOverlayContribution[];
  /** MCP tools the plugin exposes to an AI client, merged from the agent and
   * gcs `contributes.tools[]` blocks (each stamped with its half). */
  contributesTools?: ParsedToolContribution[];
}
