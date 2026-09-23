/**
 * @module FinalizeGcsInstall
 * @description The GCS-side completion of a plugin install. Every
 * transport (LAN-direct file, cloud-relay, registry-from-URL) hands the
 * agent its archive; this step records the install on the GCS side so
 * the operator's Plugins list reflects it AND — for a plugin that ships
 * a GCS half — extracts the built iframe bundle, wraps it in a minimal
 * null-origin HTML shell, uploads that to Convex `_storage`, and records
 * the slot contributions so the live contribution producer
 * (`use-plugin-contributions`) mounts the plugin's sandboxed iframes.
 *
 * Why a shell, not the raw bundle: `PluginIframeHost` sets the iframe
 * `src` to the stored artifact and the sandbox (`allow-scripts`, no
 * `allow-same-origin`) loads it at a null origin. The build emits an ESM
 * module (`gcs/plugin.bundle.js`) which a browser cannot execute as a
 * document, so the host needs an HTML page that inlines the module. The
 * plugin's `definePlugin(...)` boots on module load and creates its own
 * mount node under `document.body`, so the shell only needs a body.
 *
 * Why this runs on the GCS, not the agent: the agent never uploads to
 * Convex storage, and the iframe bundle must live where the browser can
 * fetch it. The registry grid is itself Convex-served, so a registry
 * install always has Convex available; a local-file install already
 * holds the archive bytes. For a registry install the archive bytes are
 * fetched through the same-origin `/api/registry-archive` proxy so the
 * browser is not subject to the release CDN's cross-origin policy.
 *
 * Because this step holds the exact bytes whose bundle will run in an iframe
 * under the operator's session, it is also the GCS's signature gate: the
 * archive's detached Ed25519 signature is verified against an enrolled public
 * key (`plugins/archive-signature`) before anything is extracted, uploaded or
 * recorded, and the install row carries the signer id that VERIFIED rather than
 * the one the manifest or registry row declared.
 *
 * @license GPL-3.0-only
 */

import JSZip from "jszip";

import { PLUGIN_FRAME_HEAD } from "@/lib/plugins/iframe-csp";
import type { InstallManifestSummary } from "../install-dialog/types";
import { computeSha256 } from "./manifest-parse";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type { PairedNodeProfile } from "@/lib/plugins/types";
import {
  verifyArchiveSignature,
  type ArchiveSignatureResult,
} from "@/lib/plugins/archive-signature";
import {
  buildGcsContributes,
  buildGcsParameters,
  buildGcsFlightSkills,
  buildGcsTargetActions,
  type InstallFlightSkill,
  type InstallTargetAction,
} from "./build-install-contributions";

/** The canonical GCS bundle path inside a `.adosplug`. The packer
 * asserts this entry exists before publishing, and the manifest schema
 * fixes the gcs entrypoint to it. */
const GCS_BUNDLE_PATH = "gcs/plugin.bundle.js";

/** Convex `source` discriminator for the install row. */
export type InstallSourceKind = "local_file" | "git_url" | "registry" | "builtin";

/** Convex callables the finalize step needs. Typed loosely so the dialog
 * hands in the result of `useAction(...)` / `useMutation(...)` directly;
 * the server validators own the authoritative shapes. */
export interface GcsInstallCallables {
  /** Stores the iframe document server-side for the signed-in user and
   * returns its storage id; the install row may only reference a bundle
   * stored this way. */
  storeBundle: (args: { html: string }) => Promise<string>;
  /** Records the install row; returns the new install id. */
  recordInstall: (args: RecordInstallArgs) => Promise<string>;
  /** Grants one operator-approved declared permission. */
  grantPermission: (args: {
    installId: string;
    permissionId: string;
  }) => Promise<unknown>;
  /** Flips the install lifecycle status. */
  setStatus: (args: { installId: string; status: string }) => Promise<unknown>;
}

export interface RecordInstallArgs {
  droneId?: string;
  pluginId: string;
  version: string;
  name: string;
  source: InstallSourceKind;
  sourceUri?: string;
  signerId?: string;
  manifestHash: string;
  halves: string[];
  declaredPermissions: Array<{ id: string; required: boolean }>;
  bundleStorageId?: string;
  gcsContributes?: Array<{
    slot: string;
    panelId: string;
    title?: string;
    icon?: string;
    order?: number;
    profile?: PairedNodeProfile[];
  }>;
  /** Denormalized declarative parameter contributions from the manifest, so
   * the native parameter panel renders without a manifest re-fetch. */
  gcsParameters?: PluginParameter[];
  /** Denormalized flight-skill contributions, so the cockpit Skill Bar mounts
   * the plugin skill for a cloud operator without a manifest re-fetch. */
  flightSkills?: InstallFlightSkill[];
  /** Denormalized cockpit target-action contributions, so the click-a-target
   * popup lists them for a cloud operator without a manifest re-fetch. */
  targetActions?: InstallTargetAction[];
}

export interface FinalizeGcsInstallInputs {
  /** The archive bytes when the GCS already holds them (file/cloud). */
  archive?: Blob;
  /** Canonical archive URL when the GCS must fetch them (registry). */
  archiveUrl?: string;
  /** SHA-256 the registry publishes for `archiveUrl`; fetched bytes that
   * hash to anything else are refused. */
  expectedSha256?: string;
  manifest: InstallManifestSummary & { manifestHash?: string };
  /** Manifest hash from the dialog's parse (authoritative identity). */
  manifestHash: string;
  /** Operator-approved permission ids. */
  grantedPermissions: ReadonlyArray<string>;
  /** Target drone wire id, or null for a fleet-wide GCS-only plugin. */
  deviceId: string | null;
  source: InstallSourceKind;
  /** Origin URI recorded on the install row (the registry URL). */
  sourceUri?: string;
  /** Whether the drone's agent confirmed the plugin is enabled. A plugin
   * with an agent half is recorded as enabled only then; otherwise the row
   * stays "installed" and the operator enables it from the drone. */
  agentEnabled: boolean;
  callables: GcsInstallCallables;
  /** Injected for tests; defaults to the browser `fetch`. */
  fetchImpl?: typeof fetch;
}

export class FinalizeGcsInstallError extends Error {
  readonly stage: FinalizeStage;
  constructor(stage: FinalizeStage, message: string) {
    super(message);
    this.name = "FinalizeGcsInstallError";
    this.stage = stage;
  }
}

export type FinalizeStage =
  | "fetch-archive"
  | "verify-signature"
  | "extract-bundle"
  | "upload-bundle"
  | "record"
  | "grant"
  | "enable";

/**
 * Wrap an ESM plugin bundle in a minimal HTML document the sandboxed
 * iframe can load and execute. The `</script` escape keeps a bundle that
 * happens to contain that byte sequence (in a string literal) from
 * closing the inline module early.
 *
 * The document starts its head with the shared plugin-frame policy and guard
 * script from `plugins/iframe-csp`. The frame is a `blob:` document, which
 * inherits the app's policy — and the app has to allow bare `http:`/`ws:` in
 * `connect-src` to reach LAN agents, so inheritance alone leaves a sandboxed
 * plugin with full outbound network reach. The in-document policy pins it to
 * `connect-src 'none'`, and the guard removes WebRTC, which CSP does not
 * govern.
 */
export function buildIframeHtml(bundleJs: string): string {
  const safe = bundleJs.replace(/<\/(script)/gi, "<\\/$1");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    PLUGIN_FRAME_HEAD,
    '<meta charset="utf-8">',
    '<meta name="color-scheme" content="dark light">',
    "<style>html,body{margin:0;padding:0;height:100%;background:transparent;overflow:hidden}</style>",
    "</head>",
    "<body>",
    `<script type="module">\n${safe}\n</script>`,
    "</body>",
    "</html>",
  ].join("");
}

/**
 * Complete a plugin install on the GCS side. Returns the new install id,
 * or null when there was nothing to do. Throws `FinalizeGcsInstallError`
 * with a stage tag on any wire failure so the caller can surface a
 * precise, non-fatal notice (the agent half installs regardless).
 */
export async function finalizeGcsInstall(
  inputs: FinalizeGcsInstallInputs,
): Promise<string | null> {
  const { manifest, callables } = inputs;
  const doFetch = inputs.fetchImpl ?? fetch;
  const hasGcsHalf = manifest.halves.includes("gcs");

  let bundleStorageId: string | undefined;
  let gcsContributes: RecordInstallArgs["gcsContributes"];
  /**
   * The signer id the archive's signature actually verified under, or
   * undefined. Recorded on the install row in place of `manifest.signerId` so
   * the row can never carry a signer the GCS did not verify.
   *
   * An agent-only plugin (no GCS half) never reaches the GCS as bytes, so this
   * stays undefined and the row carries no signer — the agent's own
   * `/etc/ados/plugin-keys/` check is the gate for that half.
   */
  let verifiedSignerId: string | undefined;
  // Declarative parameters, flight skills, and target actions are recorded for
  // every plugin that declares them, independent of whether it ships an iframe
  // GCS half — a skill / target-action drives a cockpit behavior with no iframe.
  const gcsParameters = buildGcsParameters(manifest);
  const flightSkills = buildGcsFlightSkills(manifest);
  const targetActions = buildGcsTargetActions(manifest);

  if (hasGcsHalf) {
    // 1. Obtain the archive bytes.
    let archive: Blob;
    if (inputs.archive) {
      archive = inputs.archive;
    } else if (inputs.archiveUrl) {
      let res: Response;
      try {
        res = await doFetch(
          `/api/registry-archive?url=${encodeURIComponent(inputs.archiveUrl)}`,
        );
      } catch (err) {
        throw new FinalizeGcsInstallError(
          "fetch-archive",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (!res.ok) {
        throw new FinalizeGcsInstallError(
          "fetch-archive",
          `archive fetch failed: HTTP ${res.status}`,
        );
      }
      archive = await res.blob();
      const expected = inputs.expectedSha256?.trim().toLowerCase();
      if (expected && (await computeSha256(archive)) !== expected) {
        throw new FinalizeGcsInstallError(
          "fetch-archive",
          "archive does not match the hash its registry entry publishes",
        );
      }
    } else {
      throw new FinalizeGcsInstallError(
        "fetch-archive",
        "no archive bytes or url supplied for a GCS-half plugin",
      );
    }

    // 2. Verify the archive's detached Ed25519 signature BEFORE any of its
    // contents are extracted, uploaded or recorded. This is the GCS's own
    // trust gate: these are the exact bytes whose bundle is about to run in an
    // iframe under the operator's session, so a declared-but-unbacked signer,
    // an unenrolled signer, or contents that do not match the signature are
    // refused here rather than trusted from a manifest or registry field.
    let signature: ArchiveSignatureResult;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(archive);
      signature = await verifyArchiveSignature(zip, manifest.signerId);
    } catch (err) {
      throw new FinalizeGcsInstallError(
        "verify-signature",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (signature.state === "invalid") {
      throw new FinalizeGcsInstallError(
        "verify-signature",
        `archive signature did not verify: ${signature.reason ?? "unknown reason"}`,
      );
    }
    verifiedSignerId = signature.verifiedSignerId;

    // 3. Extract the built GCS bundle.
    let bundleJs: string;
    try {
      const entry =
        zip.file(GCS_BUNDLE_PATH) ?? zip.file(`./${GCS_BUNDLE_PATH}`);
      if (!entry) {
        throw new Error(`archive is missing ${GCS_BUNDLE_PATH}`);
      }
      bundleJs = await entry.async("string");
    } catch (err) {
      throw new FinalizeGcsInstallError(
        "extract-bundle",
        err instanceof Error ? err.message : String(err),
      );
    }

    // 4. Wrap the bundle in its iframe document and have the server store it.
    try {
      bundleStorageId = await callables.storeBundle({ html: buildIframeHtml(bundleJs) });
    } catch (err) {
      throw new FinalizeGcsInstallError(
        "upload-bundle",
        err instanceof Error ? err.message : String(err),
      );
    }

    gcsContributes = buildGcsContributes(manifest);
  }

  // 5. Record the install row (every install, GCS half or not).
  let installId: string;
  try {
    installId = await callables.recordInstall({
      droneId: inputs.deviceId ?? undefined,
      pluginId: manifest.pluginId,
      version: manifest.version,
      name: manifest.name,
      source: inputs.source,
      sourceUri: inputs.sourceUri,
      signerId: verifiedSignerId,
      manifestHash: inputs.manifestHash,
      halves: [...manifest.halves],
      declaredPermissions: manifest.permissions.map((p) => ({
        id: p.id,
        required: p.required,
      })),
      bundleStorageId,
      gcsContributes,
      gcsParameters,
      flightSkills,
      targetActions,
    });
  } catch (err) {
    throw new FinalizeGcsInstallError(
      "record",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 6. Grant the operator-approved permissions. Only ids the manifest
  // declared are grantable; the server rejects anything else.
  const declared = new Set(manifest.permissions.map((p) => p.id));
  for (const permissionId of inputs.grantedPermissions) {
    if (!declared.has(permissionId)) continue;
    try {
      await callables.grantPermission({ installId, permissionId });
    } catch (err) {
      throw new FinalizeGcsInstallError(
        "grant",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // 7. Enable so the contribution producer mounts the GCS half. The
  // producer filters to enabled/running installs. A plugin with an agent
  // half is marked enabled only once the agent itself enabled it; the row
  // otherwise stays "installed", which is what the drone reports.
  if (inputs.agentEnabled || !manifest.halves.includes("agent")) {
    try {
      await callables.setStatus({ installId, status: "enabled" });
    } catch (err) {
      throw new FinalizeGcsInstallError(
        "enable",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return installId;
}
