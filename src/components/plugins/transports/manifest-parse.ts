/**
 * @module ManifestParse
 * @description Client-side `.adosplug` archive inspection. Extracts
 * `manifest.yaml`, parses it into a typed preview, and computes a SHA-256
 * over the archive bytes. The cloud-relay path needs the hash for archive
 * deduplication; the LAN-direct path uses the agent's `/api/plugins/parse`
 * instead, so the parse here is a client-side preview for the install
 * dialog, not the authority on what installs.
 *
 * @license GPL-3.0-only
 */

import YAML from "yaml";

import {
  verifyArchiveSignature,
  type ArchiveSignatureResult,
} from "@/lib/plugins/archive-signature";
import { parseParameterContributions } from "@/lib/plugins/parameters/parse";
import {
  parseTabContributions,
  parseSettingsContributions,
  parseModelContributions,
  parseMissionTemplateContributions,
  parseMapOverlayContributions,
  parseToolContributions,
  type ParsedToolContribution,
} from "@/lib/plugins/contributions/parse";
import type { PluginHalf } from "@/lib/plugins/types";

import {
  parseSkillContributions,
  parseSlotContributions,
  parseTargetActionContributions,
} from "./manifest-contributions";
import type {
  ParsedFcParameter,
  ParsedHardwareRequirements,
  ParsedManifest,
  ParsedRequiredFcParameters,
  ParsedResourceImpact,
  ParsedScreenshot,
} from "./manifest-types";
import { isObject, num, str, stringArray } from "./manifest-values";

/** Compute SHA-256 over archive bytes using the browser SubtleCrypto API.
 * Returns the lowercase hex string Convex expects for archive dedup. */
export async function computeSha256(file: Blob): Promise<string> {
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
  // Loaded on demand rather than statically: the registry grid imports this
  // module on every node page, and only an archive pick needs the unzipper.
  const { default: JSZip } = await import("jszip");
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
    gcsEntrypoint: str(gcs?.entrypoint),
    // A GCS half defaults to the sandboxed iframe; only an exact `inline`
    // declaration asks for the trusted in-page module.
    gcsIsolation: gcs ? (gcs.isolation === "inline" ? "inline" : "iframe") : undefined,
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
