/**
 * @module node-detail/surfaces
 * @description The profile -> surface registry for BUILT-IN node-detail tabs,
 * one instance of the generic contribution factory
 * (`createContributionRegistry`). `resolveSurfaces` returns the visible set for
 * a node (profile / capability / role filtered); an unknown/future profile
 * registered nothing, so it falls back to the Agent page and the panel never
 * renders empty.
 *
 * Scope, stated precisely because the earlier version of this note was wrong:
 * **plugin-contributed node-detail tabs do NOT register here.** They reach the
 * UI through `useDronePluginContributions`, rendered by
 * `DroneDetailTabHeaders` / `DroneDetailTabBody` as a sibling strip after the
 * resolved built-in tabs (`NodeDetailPanel` short-circuits the registry for a
 * `plugin:` tab id). The only exerciser of a `source: "plugin"` contribution on
 * this registry is `__tests__/surface-registry.test.ts`.
 *
 * That split is deliberate, not a missing migration. This registry is
 * populated once at module load from three static arrays, and `resolveSurfaces`
 * is a pure synchronous function of `SurfaceContext` — which is what makes the
 * profile/capability/role gates unit-testable without a store or a network.
 * Plugin tabs are per-node async data (a Convex query joined with signed bundle
 * blobs), so routing them through here would mean mutating module-global state
 * from a network-driven effect, keying registrations per node rather than per
 * profile, and reconciling a static list against one that arrives later. The
 * generic factory's built-in-equals-plugin duality is real for Skills and
 * cockpit widgets, whose contributions are also static; it is not real here.
 * @license GPL-3.0-only
 */

import { createContributionRegistry } from "@/lib/plugins/registries/contribution-registry";
import type { NodeProfile, SurfaceContext, SurfaceSpec } from "./surface-types";
import { DRONE_SURFACES } from "./surfaces/drone";
import { GROUND_STATION_SURFACES } from "./surfaces/ground-station";
import { WORKSTATION_SURFACES } from "./surfaces/workstation";
import { AGENT_SURFACE } from "./agent/agent-surface";

/**
 * One registered node-detail surface. A built-in profile surface and a
 * plugin-contributed tab share this shape ({ id, source, order, when, payload })
 * so both live in the one registry and resolve through one ordered list.
 */
export interface SurfaceContribution {
  /** Registry key — profile-namespaced ("drone:overview") so tab ids that
   * repeat across profiles (every profile has an "overview" + "agent") stay
   * unique in the single registry. */
  id: string;
  /** Provenance tag carried by the generic contribution shape. Every
   * contribution on THIS registry is `"builtin"`; see the module note for why
   * plugin node-detail tabs take a different path. */
  source: "builtin" | "plugin";
  /** Sort hint; an unordered contribution sorts after every ordered one, then
   * by registration order — so a profile's built-in array keeps its authored
   * order without per-item `order` numbers. */
  order?: number;
  /** The node profile this surface belongs to — the resolve filter key. */
  profile: NodeProfile;
  /** Availability gate (capability / role / connection). Absent = always.
   * Mirrors `payload.when`, lifted here so the resolve filter reads the gate
   * without unwrapping the payload. */
  when?: (ctx: SurfaceContext) => boolean;
  /** The surface descriptor the panel renders unchanged. Its `id` is the bare
   * tab id ("overview"); it carries labelKey / group / render. */
  payload: SurfaceSpec;
}

/**
 * The node-detail surface registry. A Zustand hook; call `.getState()` for
 * imperative access (register/unregister/resolve) and use a selector in
 * components. Built-in surfaces register at module load.
 */
export const useSurfaceRegistry =
  createContributionRegistry<SurfaceContribution>();

/** The built-in profiles and their authored surface lists. */
const PROFILE_ENTRIES: ReadonlyArray<readonly [NodeProfile, SurfaceSpec[]]> = [
  ["drone", DRONE_SURFACES],
  ["ground-station", GROUND_STATION_SURFACES],
  ["workstation", WORKSTATION_SURFACES],
];

/** Wrap a built-in profile surface as a source-tagged contribution. `when` is
 * lifted from the spec so the resolve filter reads the gate directly. */
function builtinContribution(
  profile: NodeProfile,
  spec: SurfaceSpec,
): SurfaceContribution {
  return {
    id: `${profile}:${spec.id}`,
    source: "builtin",
    profile,
    when: spec.when,
    payload: spec,
  };
}

let builtinsRegistered = false;

/** Register the built-in profile surfaces into the registry once. Idempotent
 * (module-guarded), mirroring `registerBuiltinCockpitWidgets`. Registration
 * order is preserved as the intra-profile display order. */
export function registerBuiltinSurfaces(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  const { register } = useSurfaceRegistry.getState();
  for (const [profile, specs] of PROFILE_ENTRIES) {
    for (const spec of specs) register(builtinContribution(profile, spec));
  }
}

// Register at module load so the first `resolveSurfaces` call (in the panel's
// render) sees the built-ins — the module is imported wherever resolveSurfaces
// is used.
registerBuiltinSurfaces();

/** The ordered, capability/role-filtered surface list for the selected node.
 * Built-in surfaces and plugin tabs resolve through the one registry; an
 * unknown / future profile registered nothing so it gets just the Agent page. */
export function resolveSurfaces(ctx: SurfaceContext): SurfaceSpec[] {
  const profile = (ctx.drone.profile ?? "drone") as NodeProfile;
  const matched = useSurfaceRegistry
    .getState()
    .resolve((c) => c.profile === profile && (c.when ? c.when(ctx) : true))
    .map((c) => c.payload);
  return matched.length > 0 ? matched : [AGENT_SURFACE];
}
