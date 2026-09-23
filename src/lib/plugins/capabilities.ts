/**
 * Canonical capability catalog for ADOS plugin GCS halves.
 *
 * Authoritative list of named capabilities the GCS half of a plugin
 * manifest may declare. The install dialog surfaces these in the
 * permission summary and risk badge. Today only `ui.slot.*`
 * registration is enforced by the slot whitelist; the rest are
 * recorded in the install record and shown to the operator at install
 * time, with runtime gates landing per surface as it ships.
 *
 * The id list (`GCS_CAPABILITIES`) and the metadata (`CAPABILITY_CATALOG`)
 * are generated from `capabilities.toml` by `ados-capabilities-codegen`,
 * which emits the same catalog for Python, Rust, and TypeScript so the three
 * cannot drift. The generated data lives in `./gcs-capabilities.generated`;
 * this module re-exports it and adds the types, the consistency check, and the
 * helpers. Edit the TOML and regenerate, never the generated file.
 *
 * Agent-side capability ids come back from the agent `/api/plugins/parse` and
 * `/api/plugins/install` endpoints with the same metadata fields already
 * inlined; the GCS also keeps a mirror at `./agent-capabilities.ts` for the
 * cloud-relay preview path where the dialog parses the manifest before the
 * agent ever sees the archive. `getMergedCapabilityMeta()` consults the
 * catalog of the half that declared the permission first (the agent mirror for
 * untagged rows) and falls back to the other catalog only when the id is absent
 * there, then to an "unknown" placeholder for ids neither catalog declares.
 */

import { AGENT_CAPABILITY_CATALOG } from "./agent-capabilities";
import type { PluginHalf } from "./types";
import {
  GCS_CAPABILITIES,
  GCS_CAPABILITY_CATALOG as CAPABILITY_CATALOG,
} from "./gcs-capabilities.generated";

export { GCS_CAPABILITIES, CAPABILITY_CATALOG };

export type GcsCapability = (typeof GCS_CAPABILITIES)[number];

export type CapabilityCategory =
  | "hardware"
  | "flight_control"
  | "data_network"
  | "compute_process"
  | "ui_slot";

export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export interface CapabilityMeta {
  /** Short action-verb sentence (6-10 words) for the dialog row title. */
  label: string;
  /** One-paragraph what-it-does + why-it-matters body. */
  description: string;
  category: CapabilityCategory;
  risk: CapabilityRisk;
  /** One-line explanation rendered next to the risk badge. */
  risk_reason: string;
}

// Build-time consistency check: every id in `GCS_CAPABILITIES` must
// have a catalog entry, and the catalog must not carry orphan ids.
// Module load fails loudly on drift.
{
  const known = new Set(Object.keys(CAPABILITY_CATALOG));
  const missing = GCS_CAPABILITIES.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new Error(
      `GCS_CAPABILITIES missing CAPABILITY_CATALOG entries: ${missing.join(", ")}`,
    );
  }
  const declared = new Set<string>(GCS_CAPABILITIES);
  const orphan = Object.keys(CAPABILITY_CATALOG).filter(
    (id) => !declared.has(id),
  );
  if (orphan.length > 0) {
    throw new Error(
      `CAPABILITY_CATALOG has entries not in GCS_CAPABILITIES: ${orphan.join(
        ", ",
      )}`,
    );
  }
}

export function isKnownGcsCapability(cap: string): cap is GcsCapability {
  return (GCS_CAPABILITIES as readonly string[]).includes(cap);
}

/** Return the GCS-side catalog entry for `id`, or `undefined` if the
 * id is not declared on the GCS half. Agent-side ids are not
 * resolved here — they arrive from the agent with metadata already
 * inlined by the parse + install endpoints. */
export function getCapabilityMeta(id: string): CapabilityMeta | undefined {
  return CAPABILITY_CATALOG[id];
}

/** Equivalent to `getCapabilityMeta(id) !== undefined`. Exposed for
 * symmetry with the agent-side helper. */
export function isKnownCapability(id: string): boolean {
  return id in CAPABILITY_CATALOG;
}

/** Base ids of the capabilities the dispatch layer scopes with a topic
 * suffix (`telemetry.subscribe` -> `telemetry.subscribe.<topic>`). A driver
 * plugin grants the topic-scoped form, so the catalog resolver maps it back
 * to the base entry. */
const PER_STREAM_CAPABILITY_BASES = ["telemetry.subscribe"] as const;

/** The base capability id for a topic-scoped per-stream capability, or null
 * when `id` is not a recognized per-stream form. */
function perStreamBaseCapability(id: string): string | null {
  for (const base of PER_STREAM_CAPABILITY_BASES) {
    if (id.startsWith(`${base}.`) && id.length > base.length + 1) {
      return base;
    }
  }
  return null;
}

type CatalogOrder = ReadonlyArray<Readonly<Record<string, CapabilityMeta>>>;

function lookupCatalogs(
  catalogs: CatalogOrder,
  id: string,
): CapabilityMeta | undefined {
  for (const catalog of catalogs) {
    if (Object.hasOwn(catalog, id)) return catalog[id];
  }
  return undefined;
}

/**
 * Merged lookup for the install dialog.
 *
 * Both halves of a plugin manifest declare permissions and both halves
 * render in the same review surface. Several ids (`mission.read`,
 * `event.publish`, ...) exist in both catalogs with different meanings, so the
 * catalog of the declaring half wins: GCS-half rows resolve through the local
 * catalog above, agent-half and untagged rows through the mirror at
 * `agent-capabilities.ts`. The other catalog is consulted only when the id is
 * absent from the preferred one. Unknown ids fall back to a placeholder that
 * flags the id as unknown so the UI can render a muted row with the raw id.
 */
export function getMergedCapabilityMeta(
  id: string,
  half: PluginHalf | undefined,
): CapabilityMeta {
  const catalogs: CatalogOrder =
    half === "gcs"
      ? [CAPABILITY_CATALOG, AGENT_CAPABILITY_CATALOG]
      : [AGENT_CAPABILITY_CATALOG, CAPABILITY_CATALOG];
  const direct = lookupCatalogs(catalogs, id);
  if (direct !== undefined) {
    return direct;
  }
  // A topic-scoped per-stream grant (e.g. `telemetry.subscribe.navigation`)
  // resolves to its base entry so a plugin that narrows its grant to one
  // stream still renders a real label/description instead of "unknown".
  const base = perStreamBaseCapability(id);
  if (base !== null) {
    const baseMeta = lookupCatalogs(catalogs, base);
    if (baseMeta !== undefined) {
      const topic = id.slice(base.length + 1);
      return {
        ...baseMeta,
        description: `${baseMeta.description} Scoped to the "${topic}" stream.`,
      };
    }
  }
  return inferUnknownCapabilityMeta(id);
}

/**
 * Placeholder catalog entry for capability ids the GCS does not
 * recognise. Used when an install preview surfaces a third-party
 * permission the bundled mirror has not been refreshed to include
 * yet. The dialog reads `unknown === true` to render the raw id as
 * the row title and skip the description body.
 */
export interface UnknownCapabilityMeta extends CapabilityMeta {
  unknown: true;
}

export function inferUnknownCapabilityMeta(
  id: string,
): UnknownCapabilityMeta {
  return {
    label: id,
    description: "",
    category: "compute_process",
    risk: "low",
    risk_reason: "Unknown capability id; review the plugin source before granting.",
    unknown: true,
  };
}
