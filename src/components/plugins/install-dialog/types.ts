/**
 * @module InstallDialogTypes
 * @description Shared types used by the per-drone plugin install
 * dialog. Split out of `PluginInstallDialog.tsx` so the orchestrator
 * file stays under the 300 LOC soft ceiling. These shapes are imported
 * by transports, sections, and the registry-card grid; keep them
 * forward-compatible — older agents and manifests may omit any of the
 * rich content fields, and the modal falls back to the legacy short
 * summary.
 *
 * @license GPL-3.0-only
 */

import type {
  GcsContributeRow,
  GcsIsolation,
  PluginHalf,
  PairedNodeProfile,
} from "@/lib/plugins/types";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type { ParsedToolContribution } from "@/lib/plugins/contributions/parse";
import type { PluginSignatureState } from "@/lib/plugins/archive-signature";

import type { TrustSignal } from "@/lib/plugins/trust-signals";

/** Manifest summary the dialog needs to render the pre-install screen. */
export interface InstallManifestSummary {
  pluginId: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  halves: ReadonlyArray<PluginHalf>;
  /** `gcs.entrypoint`: the archive path of the GCS half's module. */
  gcsEntrypoint?: string;
  /** How the GCS half mounts (iframe by default, or a trusted inline
   * module). Undefined when the plugin has no GCS half. */
  gcsIsolation?: GcsIsolation;
  /**
   * The signer id the archive's Ed25519 signature verified under. Present ONLY
   * when `signatureState === "verified"` — a `signer_id` declared inside the
   * archive never reaches this field.
   */
  signerId?: string;
  /** Outcome of verifying the archive's detached signature. The gate every
   * trust badge derives from; see `plugins/archive-signature`. */
  signatureState: PluginSignatureState;
  trustSignals: ReadonlyArray<TrustSignal>;
  /** A shared-vocabulary named icon the manifest declares at the top level
   * (e.g. `icon: "camera"`). Drives the pop-up header glyph. */
  icon?: string;
  /** Public homepage / source repository URL the manifest declares
   * (`homepage`). Rendered as a Repository link in the sidebar. */
  homepageUrl?: string;
  permissions: ReadonlyArray<{
    id: string;
    required: boolean;
    /** Which half declared the permission. `agent` permissions count
     * toward the install button's grant total; `gcs` permissions render
     * but are not granted through the agent install path. */
    half?: PluginHalf;
    /** Plain-language sentence rendered as the permission row title. */
    label?: string;
    /** Body paragraph describing what the permission unlocks. */
    description?: string;
    /** Coarse grouping the dialog can use for section headers. */
    category?:
      | "hardware"
      | "flight_control"
      | "data_network"
      | "compute_process"
      | "ui_slot";
    /** Per-permission risk classification rendered as a small badge. */
    risk?: "low" | "medium" | "high" | "critical";
    /** One-line explanation rendered next to the per-permission badge. */
    risk_reason?: string;
    /** True when the permission id is not in the catalog the dialog
     * knows about. The agent's REST gate refuses such manifests
     * outright; this flag only fires on the local-file client-side
     * preview path when the GCS has no agent-side catalog to ask. */
    unknown?: boolean;
  }>;
  /** Optional vendor-attribution entries the agent-half manifest
   * declares. Used to detect NPU vendor SDKs when deriving the NPU
   * capability chip, and rendered as a sidebar branch + warning row in
   * the install modal so the operator sees closed-source dependencies
   * before approving. */
  vendorAttribution?: ReadonlyArray<{
    name?: string;
    license?: string;
    source_url?: string;
    upstream_version?: string;
    notice?: string;
  }>;
  /** SHA-256 hex of the archive bytes, when the registry row carries
   * one. Surfaced in the sidebar metadata block for click-to-copy. */
  archiveSha256?: string;
  /** Long-form paragraph that supplements the short ``description``. */
  descriptionLong?: string;
  /** Bullet list of headline features the plugin ships. */
  features?: ReadonlyArray<string>;
  /** Hardware-side requirements the operator should verify. */
  hardwareRequirements?: {
    cameras?: string;
    fcFirmware?: string;
    boards?: ReadonlyArray<string>;
    optional?: ReadonlyArray<string>;
  };
  /** Forecast runtime impact. The supervisor still enforces the hard
   * limits declared under the agent's ``resources`` block; these
   * numbers are pure copy. */
  resourceImpact?: {
    cpuPercentPeak?: number;
    ramMb?: number;
    pids?: number;
    startupTimeSeconds?: number;
    /** Output update rate (Hz) — preferred over `cpuPercentPeak` in
     * the modal grid because it's operator-meaningful for plugins that
     * push a steady telemetry stream (pose, video frames, sensor
     * samples). When both are set, the renderer shows this. */
    outputRateHz?: number;
  };
  /** Per-firmware FC parameter hints the operator should set after
   * install. Each firmware bucket is optional so a plugin can ship
   * guidance for only the firmware it actually targets. */
  requiredFcParameters?: {
    ardupilot?: ReadonlyArray<{
      param: string;
      note?: string;
      value?: string | number;
    }>;
    px4?: ReadonlyArray<{
      param: string;
      note?: string;
      value?: string | number;
    }>;
    inav?: ReadonlyArray<{
      param: string;
      note?: string;
      value?: string | number;
    }>;
  };
  /** Telemetry topic paths the plugin will publish once running. */
  telemetryFields?: ReadonlyArray<string>;
  /** Public-docs URL (https:// only). */
  documentationUrl?: string;
  /** Screenshot URLs rendered as a gallery in the modal. */
  screenshots?: ReadonlyArray<{ url: string; caption?: string }>;
  /** Flight skills the GCS half contributes to the cockpit Skill Bar. The
   * modal preview line uses `id`/`label`; the full fields are threaded into the
   * install record's persisted `flightSkills` denorm so a cloud operator's
   * Skill Bar mounts the plugin skill with its activation + state wiring
   * (matching the local-first path that reads them from the agent). */
  contributesSkills?: ReadonlyArray<{
    id: string;
    label: string;
    icon?: string;
    category?: "behavior" | "camera" | "navigation" | "utility";
    toggle?: boolean;
    confirm?: boolean;
    armRequirement?: "any" | "armed" | "disarmed" | null;
    /** Per-drone config key the skill toggle writes (activation.config_key). */
    configKey?: string;
    /** Event topic the skill reads its live state from (state.topic). */
    stateTopic?: string;
    defaultBinding?: { key?: string | null; gamepadButton?: number | null };
  }>;
  /** Cockpit target actions the GCS half adds to the click-a-target popup
   * (`gcs.contributes.target_actions[]`). Threaded into the install record's
   * persisted `targetActions` denorm so a cloud operator's popup lists them
   * beside the built-in actions (matching the local-first path). */
  contributesTargetActions?: ReadonlyArray<{
    id: string;
    label?: string;
    icon?: string;
    order?: number;
    appliesToClass?: string;
    designate?: boolean;
    configKey?: string;
    configValue?: boolean;
    defaultKey?: string;
  }>;
  /** Slot contributions (panels / overlays / notifications / agent pages /
   * node surfaces) the GCS half mounts. Threaded straight into
   * `recordInstall`'s `gcsContributes` arg so the live contribution producer
   * (`use-plugin-contributions`) can mount the plugin's surfaces once the
   * install row lands. Each slot is validated against the canonical
   * `PLUGIN_SLOTS` at parse time, so bogus slots never reach here. */
  contributesSlots?: ReadonlyArray<GcsContributeRow>;
  /** Node-detail tab contributions (`gcs.contributes.tabs[]`), each
   * optionally narrowed to a node-profile set. Threaded into the install
   * record so a `node.detail.tab` contribution can be profile-filtered to
   * the node it mounts on (a drone-only tab never shows on a ground station).
   * The slot itself is also carried in `contributesSlots`; this array is the
   * source of the per-tab `profile` narrowing. */
  contributesTabs?: ReadonlyArray<{
    panelId: string;
    profile?: ReadonlyArray<PairedNodeProfile>;
    title?: string;
    icon?: string;
    order?: number;
  }>;
  /** Declarative parameter contributions (`gcs.contributes.parameters[]`) the
   * GCS renders natively in the plugin's panel. Threaded into the install
   * record so the native parameter panel mounts without a manifest re-fetch. */
  contributesParameters?: ReadonlyArray<PluginParameter>;
  /** MCP tools the plugin exposes to an AI client (`contributes.tools[]`,
   * merged from the agent and gcs halves). Rendered in the pop-up as a
   * read-only list with a safety-class badge + collapsible input schema so the
   * operator sees what an AI client could invoke through the plugin. */
  contributesTools?: ReadonlyArray<ParsedToolContribution>;
  /** Mission templates the GCS half adds to the planner
   * (`gcs.contributes.missionTemplates[]`). Rendered in the pop-up's
   * contributions block. */
  contributesMissionTemplates?: ReadonlyArray<{
    id: string;
    title?: string;
    icon?: string;
  }>;
  /** Map overlays the GCS half adds to the map surface
   * (`gcs.contributes.mapOverlays[]`). Rendered in the pop-up's contributions
   * block alongside any `map.overlay` slot panels. */
  contributesMapOverlays?: ReadonlyArray<{
    id: string;
    title?: string;
    icon?: string;
  }>;
}

/** Origin of the archive being installed. Drives transport selection
 * inside the dialog: a `file` source uses the multipart endpoint (or
 * Convex storage on failover); a `registry` source hands the canonical
 * URL + SHA-256 pin to the agent's install-from-URL endpoint. */
export type InstallSource =
  | { kind: "file"; file: File; manifestHash: string }
  | {
      kind: "registry";
      url: string;
      expectedSha256: string;
      pluginId: string;
      version: string;
    };

/** Minimal shape the dialog needs from its target. Accepts both
 * `PairedDrone` from the pairing store and `FleetDrone` when the
 * caller maps one into the other. */
export interface InstallTargetDrone {
  /** Convex row id when the drone is paired through the cloud store,
   * or a stable client-side id when it isn't. */
  _id: string;
  /** Wire-level device id used by the agent and the cloud relay. */
  deviceId: string;
  /** Display name shown in the modal chrome. */
  name: string;
}
