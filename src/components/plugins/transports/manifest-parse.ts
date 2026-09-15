/**
 * @module ManifestParse
 * @description Client-side `.adosplug` archive inspection. Extracts
 * `manifest.yaml`, parses the small subset of YAML the manifest uses,
 * and computes a SHA-256 over the archive bytes. The cloud-relay path
 * needs the hash for archive deduplication; the LAN-direct path uses
 * the agent's `/api/plugins/parse` instead, so the YAML parse here is
 * a thin client-side preview that does not need to handle every YAML
 * edge case.
 *
 * Limited YAML support is intentional. The manifest schema is fixed by
 * `product/specs/ados-plugin-system/02-manifest-schema.md` and never
 * needs anchors, multi-line strings, or flow collections at the top
 * level. A 30-line parser is enough to render the dialog preview.
 *
 * @license GPL-3.0-only
 */

import JSZip from "jszip";
import YAML from "yaml";

import type { InstallManifestSummary } from "../install-dialog/types";
import { getMergedCapabilityMeta } from "@/lib/plugins/capabilities";
import { displayTrustSignals } from "@/lib/plugins/trust-signals";
import {
  verifyArchiveSignature,
  type ArchiveSignatureResult,
  type PluginSignatureState,
} from "@/lib/plugins/archive-signature";
import {
  parseParameterContributions,
  type ParsedParameterContribution,
} from "@/lib/plugins/parameters/parse";
import {
  parseTabContributions,
  parseSettingsContributions,
  parseModelContributions,
  parseMissionTemplateContributions,
  parseMapOverlayContributions,
  parseToolContributions,
  type ParsedTabContribution,
  type ParsedSettingsContribution,
  type ParsedModelContribution,
  type ParsedMissionTemplateContribution,
  type ParsedMapOverlayContribution,
  type ParsedToolContribution,
} from "@/lib/plugins/contributions/parse";
import {
  PLUGIN_SLOTS,
  type PluginHalf,
  type PluginSlotName,
} from "@/lib/plugins/types";

/** Compute SHA-256 over a file using the browser SubtleCrypto API.
 * Returns the lowercase hex string Convex expects for archive dedup. */
export async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Open a `.adosplug` once and return both the manifest text and the archive's
 * Ed25519 verification result.
 *
 * One zip load for both, deliberately: the signature covers a canonical hash
 * over the same entry set the manifest came from, so reading the manifest from
 * one load and verifying from another would let the two disagree.
 *
 * The manifest's own `signer_id` is fed to the verifier so a declared signer
 * the archive cannot back resolves `"invalid"` rather than `"unsigned"`.
 *
 * Throws when the file is not a valid zip or the manifest is absent. A signature
 * problem is never a throw — it comes back as `signature.state === "invalid"`
 * with a reason, so the caller decides how to refuse.
 */
export async function inspectArchive(file: File): Promise<{
  manifestYaml: string;
  signature: ArchiveSignatureResult;
}> {
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("manifest.yaml") ?? zip.file("MANIFEST.yaml");
  if (!entry) {
    throw new Error(
      "Archive is missing manifest.yaml. Is this a valid .adosplug file?",
    );
  }
  const manifestYaml = await entry.async("string");
  const declaredSigner = parseManifestYaml(manifestYaml).signerId;
  return {
    manifestYaml,
    signature: await verifyArchiveSignature(zip, declaredSigner),
  };
}

/**
 * Tiny YAML reader for the manifest's top-level scalars, the
 * `permissions` list, and the rich install-dialog content fields
 * (`description_long`, `features`, `hardware_requirements`,
 * `resource_impact`, `required_fc_parameters`, `telemetry_fields`,
 * `documentation_url`, `screenshots`). Handles only the shapes the
 * manifest schema actually uses. Returns a shape compatible with the
 * dialog summary.
 *
 * Supported:
 *   - `key: value`
 *   - `key:` followed by `  - item` lines (string or `{id: ...}` items)
 *   - inline `[a, b]` flow sequences for `halves` and
 *     `hardware_requirements.boards`
 *   - top-level `key: |` block-literal scalars (carried into
 *     `description_long`)
 *   - mapping blocks for `hardware_requirements`, `resource_impact`,
 *     `required_fc_parameters`, `screenshots`
 *   - `# comments` and blank lines
 *
 * This is intentionally a thin client-side preview parser. The agent's
 * authoritative `/api/plugins/parse` endpoint runs the strict Pydantic
 * model and remains the source of truth for installs over LAN-direct;
 * the cloud-relay path uses this preview to render the modal before
 * the archive is verified server-side. Missing rich fields stay
 * undefined for forward compatibility with older manifests.
 */
export function parseManifestYaml(text: string): ParsedManifest {
  // Real YAML 1.2 parser via the `yaml` package. The hand-rolled regex
  // tower this replaced choked on PyYAML-emitted manifests (the
  // signed-archive pipeline round-trips through PyYAML which flattens
  // block-literal scalars to double-quoted multi-line and switches
  // permission item indents from four spaces to two). Using a real
  // parser means the modal handles both the source manifest shape and
  // any downstream re-serialization without special casing.
  // `strict: false` matches PyYAML last-write-wins on duplicate keys.
  let doc: unknown;
  try {
    doc = YAML.parse(text, { strict: false }) ?? {};
  } catch (err) {
    throw new Error(
      `manifest.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const root = isObject(doc) ? doc : {};
  const agent = isObject(root.agent) ? (root.agent as Record<string, unknown>) : null;
  const gcs = isObject(root.gcs) ? (root.gcs as Record<string, unknown>) : null;

  const halves: PluginHalf[] = [];
  if (agent) halves.push("agent");
  if (gcs) halves.push("gcs");
  // Honor an explicit top-level `halves:` if present; only keep
  // recognized values.
  if (Array.isArray(root.halves)) {
    for (const h of root.halves) {
      const v = String(h).toLowerCase();
      if ((v === "agent" || v === "gcs") && !halves.includes(v)) {
        halves.push(v);
      }
    }
  }

  const permissions: Array<{ id: string; required: boolean; half?: PluginHalf }> = [];
  collectPermissions(agent?.permissions, "agent", permissions);
  collectPermissions(gcs?.permissions, "gcs", permissions);
  // Legacy top-level `permissions:` (untagged half). Vision-nav v0.2.2
  // had this shape; keeping support so historical registry rows still
  // render correctly.
  collectPermissions(root.permissions, undefined, permissions);

  return {
    pluginId: str(root.id) ?? str(root.plugin_id) ?? "",
    version: str(root.version) ?? "",
    name: str(root.name) ?? str(root.id) ?? "Unknown plugin",
    description: str(root.description),
    author: str(root.author),
    license: str(root.license),
    signerId: str(root.signer_id) ?? str((root as Record<string, unknown>).signerId),
    icon: str(root.icon),
    homepageUrl: str(root.homepage) ?? str(root.repository),
    halves,
    permissions,
    descriptionLong: str(root.description_long),
    features: stringArray(root.features),
    hardwareRequirements: parseHardwareRequirements(root.hardware_requirements),
    resourceImpact: parseResourceImpact(root.resource_impact),
    requiredFcParameters: parseRequiredFcParameters(root.required_fc_parameters),
    telemetryFields: stringArray(root.telemetry_fields),
    documentationUrl: str(root.documentation_url),
    screenshots: parseScreenshots(root.screenshots),
    contributesSkills: parseSkillContributions(
      isObject(gcs?.contributes) ? gcs?.contributes.skills : undefined,
    ),
    contributesTargetActions: parseTargetActionContributions(
      isObject(gcs?.contributes)
        ? (gcs?.contributes.target_actions ?? gcs?.contributes.targetActions)
        : undefined,
    ),
    contributesSlots: parseSlotContributions(gcs?.contributes),
    contributesParameters: parseParameterContributions(
      isObject(gcs?.contributes) ? gcs?.contributes.parameters : undefined,
    ),
    contributesTabs: parseTabContributions(
      isObject(gcs?.contributes) ? gcs?.contributes.tabs : undefined,
    ),
    contributesSettings: parseSettingsContributions(
      isObject(gcs?.contributes) ? gcs?.contributes.settings : undefined,
    ),
    contributesModels: parseModelContributions(
      isObject(gcs?.contributes) ? gcs?.contributes.models : undefined,
    ),
    contributesMissionTemplates: parseMissionTemplateContributions(
      isObject(gcs?.contributes)
        ? (gcs?.contributes.missionTemplates ?? gcs?.contributes.mission_templates)
        : undefined,
    ),
    contributesMapOverlays: parseMapOverlayContributions(
      isObject(gcs?.contributes)
        ? (gcs?.contributes.mapOverlays ?? gcs?.contributes.map_overlays)
        : undefined,
    ),
    contributesTools: mergeToolContributions(
      parseToolContributions(
        isObject(agent?.contributes) ? agent?.contributes.tools : undefined,
      ),
      parseToolContributions(
        isObject(gcs?.contributes) ? gcs?.contributes.tools : undefined,
      ),
    ),
  };
}

/**
 * Merge the agent-half and gcs-half `contributes.tools[]` into one list,
 * stamping each entry's `half` from the block it came from when the entry
 * did not declare one. Returns undefined when neither half declares a tool.
 */
function mergeToolContributions(
  agentTools: ParsedToolContribution[] | undefined,
  gcsTools: ParsedToolContribution[] | undefined,
): ParsedToolContribution[] | undefined {
  const out: ParsedToolContribution[] = [];
  for (const tool of agentTools ?? []) {
    out.push({ ...tool, half: tool.half ?? "agent" });
  }
  for (const tool of gcsTools ?? []) {
    out.push({ ...tool, half: tool.half ?? "gcs" });
  }
  return out.length > 0 ? out : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (s !== undefined && s !== "") out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

function collectPermissions(
  source: unknown,
  half: PluginHalf | undefined,
  into: Array<{ id: string; required: boolean; half?: PluginHalf }>,
): void {
  if (!Array.isArray(source)) return;
  for (const entry of source) {
    if (typeof entry === "string") {
      if (entry.trim() === "") continue;
      const row: { id: string; required: boolean; half?: PluginHalf } = {
        id: entry.trim(),
        required: true,
      };
      if (half !== undefined) row.half = half;
      into.push(row);
      continue;
    }
    if (isObject(entry)) {
      const id = str(entry.id);
      if (!id) continue;
      const required = entry.required === false ? false : true;
      const row: { id: string; required: boolean; half?: PluginHalf } = {
        id,
        required,
      };
      if (half !== undefined) row.half = half;
      into.push(row);
    }
  }
}

function parseHardwareRequirements(v: unknown): ParsedHardwareRequirements | undefined {
  if (!isObject(v)) return undefined;
  const out: ParsedHardwareRequirements = {
    cameras: str(v.cameras),
    fcFirmware: str(v.fc_firmware ?? (v as Record<string, unknown>).fcFirmware),
    boards: stringArray(v.boards),
    optional: stringArray(v.optional),
  };
  if (
    out.cameras === undefined &&
    out.fcFirmware === undefined &&
    out.boards === undefined &&
    out.optional === undefined
  ) {
    return undefined;
  }
  return out;
}

function parseResourceImpact(v: unknown): ParsedResourceImpact | undefined {
  if (!isObject(v)) return undefined;
  const out: ParsedResourceImpact = {
    cpuPercentPeak: num(v.cpu_percent_peak ?? (v as Record<string, unknown>).cpuPercentPeak),
    ramMb: num(v.ram_mb ?? (v as Record<string, unknown>).ramMb),
    pids: num(v.pids),
    startupTimeSeconds: num(
      v.startup_time_seconds ?? (v as Record<string, unknown>).startupTimeSeconds,
    ),
    outputRateHz: num(v.output_rate_hz ?? (v as Record<string, unknown>).outputRateHz),
  };
  if (
    out.cpuPercentPeak === undefined &&
    out.ramMb === undefined &&
    out.pids === undefined &&
    out.startupTimeSeconds === undefined &&
    out.outputRateHz === undefined
  ) {
    return undefined;
  }
  return out;
}

function parseFcParameterArray(v: unknown): ParsedFcParameter[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedFcParameter[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const param = str(entry.param);
    if (!param) continue;
    const row: ParsedFcParameter = { param };
    const note = str(entry.note);
    const value = str(entry.value);
    if (note !== undefined) row.note = note;
    if (value !== undefined) row.value = value;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

function parseRequiredFcParameters(v: unknown): ParsedRequiredFcParameters | undefined {
  if (!isObject(v)) return undefined;
  const out: ParsedRequiredFcParameters = {
    ardupilot: parseFcParameterArray(v.ardupilot),
    px4: parseFcParameterArray(v.px4),
    inav: parseFcParameterArray(v.inav),
  };
  if (
    out.ardupilot === undefined &&
    out.px4 === undefined &&
    out.inav === undefined
  ) {
    return undefined;
  }
  return out;
}

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
function parseSkillContributions(
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
function parseTargetActionContributions(
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
function parseSlotContributions(
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

function parseScreenshots(v: unknown): ParsedScreenshot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedScreenshot[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const url = str(entry.url);
    if (!url) continue;
    const row: ParsedScreenshot = { url };
    const caption = str(entry.caption);
    if (caption !== undefined) row.caption = caption;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

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
 * One slot-bearing `gcs.contributes` entry (a panel, overlay, or
 * notification channel). The host mounts a sandboxed iframe for the
 * plugin's `panelId` into `slot`. Shape matches the `recordInstall`
 * `gcsContributes` arg and the contribution producer's row field.
 */
export interface ParsedSlotContribution {
  /** A validated, host-known UI slot the iframe mounts into. */
  slot: PluginSlotName;
  /** Stable id within the plugin (`gcs.contributes.*[].id`). */
  panelId: string;
  /** Display title for the tab/overlay header. */
  title?: string;
  /** lucide-react icon hint. */
  icon?: string;
  /** Sort hint; the host defaults to 60 when absent. */
  order?: number;
}

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

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

/** Side inputs the caller supplies that the manifest YAML text itself cannot
 * carry: the verification outcome, and the registry-row facts the Convex
 * `registry_versions` row is authoritative for. */
export interface InstallSummaryOverrides {
  /**
   * Outcome of verifying the archive's detached signature. REQUIRED so a new
   * call site cannot omit it and inherit trust from the manifest's own
   * `signer_id`. Pass `"unverified"` when the GCS never held the archive bytes
   * (registry preview, agent-mediated parse) — the install path verifies the
   * bytes it actually executes before recording anything.
   */
  signatureState: PluginSignatureState;
  /**
   * Signer id the signature verified under. Ignored unless
   * `signatureState === "verified"`; a claim from the manifest or from a
   * registry row never reaches the summary on its own.
   */
  signerId?: string;
  /** Vendor-attribution rows from the registry. The manifest YAML's
   * agent block carries the same data, but the parser does not walk
   * `agent.vendor_attribution` today — pass the row's normalized array
   * through so the modal renders bundled vendor binaries. */
  vendorAttribution?: ReadonlyArray<{
    name?: string;
    license?: string;
    source_url?: string;
    upstream_version?: string;
    notice?: string;
  }>;
  /** SHA-256 of the archive bytes for the click-to-copy chip. */
  archiveSha256?: string;
}

/**
 * Convert a `ParsedManifest` into the dialog's `InstallManifestSummary`,
 * attaching the trust signals that follow from `overrides.signatureState`.
 *
 * The manifest's embedded `signer_id` is NOT carried through. It is an
 * unauthenticated string inside the archive the operator supplied, so the
 * summary exposes a signer id only when the archive's signature verified
 * under an enrolled key.
 */
export function toInstallSummary(
  parsed: ParsedManifest,
  manifestHash: string,
  overrides: InstallSummaryOverrides,
): InstallManifestSummary & { manifestHash: string } {
  const { signatureState } = overrides;
  const signerId =
    signatureState === "verified" ? overrides.signerId : undefined;

  // The single trust derivation (shared with the cards + the MCP tab) so a
  // plugin never reads as one badge set here and another elsewhere.
  const trustSignals = displayTrustSignals({
    signatureState,
    signerId,
    license: parsed.license,
    vendorAttribution: overrides.vendorAttribution,
  });
  return {
    pluginId: parsed.pluginId,
    version: parsed.version,
    name: parsed.name,
    description: parsed.description,
    author: parsed.author,
    license: parsed.license,
    halves: [...parsed.halves],
    signerId,
    signatureState,
    trustSignals,
    icon: parsed.icon,
    homepageUrl: parsed.homepageUrl,
    permissions: parsed.permissions.map((p) => {
      // The merged catalog resolves agent-side ids through the
      // `agent-capabilities.ts` mirror, GCS-side ids through the local
      // catalog, and unknown ids through a placeholder flagged
      // `unknown`. Either way, the row always has a label and a
      // (possibly empty) description so the modal never renders a
      // bare id without context.
      const meta = getMergedCapabilityMeta(p.id);
      const unknown =
        (meta as { unknown?: boolean }).unknown === true ? true : undefined;
      return {
        id: p.id,
        required: p.required,
        half: p.half,
        label: unknown ? undefined : meta.label,
        description: unknown ? undefined : meta.description,
        category: unknown ? undefined : meta.category,
        risk: unknown ? undefined : meta.risk,
        risk_reason: unknown ? undefined : meta.risk_reason,
        unknown,
      };
    }),
    vendorAttribution: overrides.vendorAttribution
      ? overrides.vendorAttribution.map((v) => ({ ...v }))
      : undefined,
    archiveSha256: overrides.archiveSha256,
    // Rich install-dialog content fields. Forward-compatible
    // pass-through: missing fields stay undefined so older manifests
    // and the agent's authoritative parse (which may omit any of these
    // for legacy plugins) render unchanged.
    descriptionLong: parsed.descriptionLong,
    features: parsed.features ? [...parsed.features] : undefined,
    hardwareRequirements: parsed.hardwareRequirements
      ? {
          cameras: parsed.hardwareRequirements.cameras,
          fcFirmware: parsed.hardwareRequirements.fcFirmware,
          boards: parsed.hardwareRequirements.boards
            ? [...parsed.hardwareRequirements.boards]
            : undefined,
          optional: parsed.hardwareRequirements.optional
            ? [...parsed.hardwareRequirements.optional]
            : undefined,
        }
      : undefined,
    resourceImpact: parsed.resourceImpact
      ? {
          cpuPercentPeak: parsed.resourceImpact.cpuPercentPeak,
          ramMb: parsed.resourceImpact.ramMb,
          pids: parsed.resourceImpact.pids,
          startupTimeSeconds: parsed.resourceImpact.startupTimeSeconds,
          outputRateHz: parsed.resourceImpact.outputRateHz,
        }
      : undefined,
    requiredFcParameters: parsed.requiredFcParameters
      ? {
          ardupilot: parsed.requiredFcParameters.ardupilot
            ? parsed.requiredFcParameters.ardupilot.map((p) => ({ ...p }))
            : undefined,
          px4: parsed.requiredFcParameters.px4
            ? parsed.requiredFcParameters.px4.map((p) => ({ ...p }))
            : undefined,
          inav: parsed.requiredFcParameters.inav
            ? parsed.requiredFcParameters.inav.map((p) => ({ ...p }))
            : undefined,
        }
      : undefined,
    telemetryFields: parsed.telemetryFields
      ? [...parsed.telemetryFields]
      : undefined,
    documentationUrl: parsed.documentationUrl,
    screenshots: parsed.screenshots
      ? parsed.screenshots.map((s) => ({ ...s }))
      : undefined,
    // Carry the FULL skill fields (not just id/label): the install record
    // projects them into the persisted `flightSkills` denorm so a cloud
    // operator's Skill Bar mounts the plugin skill with its activation +
    // state wiring, matching the local-first path.
    contributesSkills: parsed.contributesSkills
      ? parsed.contributesSkills.map((s) => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          category: s.category,
          toggle: s.toggle,
          confirm: s.confirm,
          armRequirement: s.armRequirement,
          configKey: s.activation.configKey,
          stateTopic: s.state.topic,
          ...(s.defaultBinding
            ? { defaultBinding: { ...s.defaultBinding } }
            : {}),
        }))
      : undefined,
    contributesTargetActions: parsed.contributesTargetActions
      ? parsed.contributesTargetActions.map((a) => ({ ...a }))
      : undefined,
    contributesSlots: parsed.contributesSlots
      ? parsed.contributesSlots.map((s) => ({ ...s }))
      : undefined,
    contributesTabs: parsed.contributesTabs
      ? parsed.contributesTabs.map((t) => ({
          panelId: t.panelId,
          ...(t.profile ? { profile: [...t.profile] } : {}),
          ...(t.title !== undefined ? { title: t.title } : {}),
          ...(t.icon !== undefined ? { icon: t.icon } : {}),
          ...(t.order !== undefined ? { order: t.order } : {}),
        }))
      : undefined,
    contributesParameters: parsed.contributesParameters
      ? parsed.contributesParameters.map((p) => ({ ...p }))
      : undefined,
    contributesTools: parsed.contributesTools
      ? parsed.contributesTools.map((tool) => ({
          ...tool,
          ...(tool.inputSchema ? { inputSchema: { ...tool.inputSchema } } : {}),
        }))
      : undefined,
    contributesMissionTemplates: parsed.contributesMissionTemplates
      ? parsed.contributesMissionTemplates.map((m) => ({
          id: m.id,
          ...(m.title !== undefined ? { title: m.title } : {}),
          ...(m.icon !== undefined ? { icon: m.icon } : {}),
        }))
      : undefined,
    contributesMapOverlays: parsed.contributesMapOverlays
      ? parsed.contributesMapOverlays.map((m) => ({
          id: m.id,
          ...(m.title !== undefined ? { title: m.title } : {}),
          ...(m.icon !== undefined ? { icon: m.icon } : {}),
        }))
      : undefined,
    manifestHash,
  };
}
