/**
 * @module manifest-summary
 * @description Projects a parsed manifest onto the install dialog's summary,
 * attaching the trust signals the archive's verification outcome supports.
 *
 * @license GPL-3.0-only
 */

import type { InstallManifestSummary } from "../install-dialog/types";
import { getMergedCapabilityMeta } from "@/lib/plugins/capabilities";
import { displayTrustSignals } from "@/lib/plugins/trust-signals";
import type { PluginSignatureState } from "@/lib/plugins/archive-signature";

import type { ParsedManifest } from "./manifest-types";

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
      // The merged catalog resolves each id through the catalog of the half
      // that declared it (agent mirror or local GCS catalog), and unknown ids
      // through a placeholder flagged `unknown`. Either way, the row always
      // has a label and a (possibly empty) description so the modal never
      // renders a bare id without context.
      const meta = getMergedCapabilityMeta(p.id, p.half);
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
