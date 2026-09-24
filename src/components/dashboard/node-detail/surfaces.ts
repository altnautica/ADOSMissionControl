/**
 * @module node-detail/surfaces
 * @description The profile -> surface registry for BUILT-IN node-detail tabs,
 * one instance of the generic contribution factory
 * (`createContributionRegistry`). `resolveSurfaces` returns the visible set for
 * a node (profile / capability / role filtered); an unknown/future profile
 * registered nothing, so it falls back to the Agent page and the panel never
 * renders empty.
 *
 * Scope: **plugin-contributed surfaces do NOT register here.** A
 * `node.detail.tab` reaches the UI through `useDronePluginContributions`,
 * rendered by `DroneDetailTabHeaders` / `DroneDetailTabBody` as a sibling strip
 * after the resolved built-in tabs (`NodeDetailPanel` short-circuits the
 * registry for a `plugin:` tab id). A `node.surface` is passed to
 * `resolveSurfaces` per call and merged into the built-in list there.
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
import type {
  NodeProfile,
  ProfileSurfaceContribution,
  SurfaceContext,
  SurfaceSpec,
} from "./surface-types";
import { DRONE_SURFACES } from "./surfaces/drone";
import { GROUND_STATION_SURFACES } from "./surfaces/ground-station";
import { WORKSTATION_SURFACES } from "./surfaces/workstation";
import { AGENT_SURFACE } from "./agent/agent-surface";

/**
 * One registered built-in node-detail surface, in the generic contribution
 * shape ({ id, order, when, payload }).
 */
export interface SurfaceContribution {
  /** Registry key — profile-namespaced ("drone:overview") so tab ids that
   * repeat across profiles (every profile has an "overview" + "agent") stay
   * unique in the single registry. */
  id: string;
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

/** Wrap a built-in profile surface as a contribution. `when` is lifted from
 * the spec so the resolve filter reads the gate directly. */
function builtinContribution(
  profile: NodeProfile,
  spec: SurfaceSpec,
): SurfaceContribution {
  return {
    id: `${profile}:${spec.id}`,
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

/** The profile whose built-in surface list a node shows. The compute profile
 * has no list of its own and shows the workstation's. */
const BUILTIN_PROFILE: Partial<Record<NodeProfile, NodeProfile>> = {
  compute: "workstation",
};

/** The ordered, capability/role-filtered surface list for the selected node.
 * An unknown / future profile registered nothing so it gets just the Agent
 * page.
 *
 * Plugin surfaces (`plugins`) for this node's profile are merged in by
 * `order`: each lands at the end of the run of surfaces sharing its `group`,
 * or, with no such run, just before the Agent surface. */
export function resolveSurfaces(
  ctx: SurfaceContext,
  plugins: ReadonlyArray<ProfileSurfaceContribution>,
): SurfaceSpec[] {
  const profile = (ctx.drone.profile ?? "drone") as NodeProfile;
  const builtinProfile = BUILTIN_PROFILE[profile] ?? profile;
  const matched = useSurfaceRegistry
    .getState()
    .resolve((c) => c.profile === builtinProfile && (c.when ? c.when(ctx) : true))
    .map((c) => c.payload);
  const surfaces = matched.length > 0 ? matched : [AGENT_SURFACE];

  const mine = plugins
    .filter((p) => p.profile.includes(profile))
    .sort((a, b) => a.order - b.order || a.spec.id.localeCompare(b.spec.id));
  for (const plugin of mine) {
    const spec: SurfaceSpec = plugin.group ? { ...plugin.spec, group: plugin.group } : plugin.spec;
    const runEnd = plugin.group
      ? surfaces.findLastIndex((s) => s.group === plugin.group)
      : -1;
    const agentAt = surfaces.findIndex((s) => s.id === AGENT_SURFACE.id);
    const at = runEnd >= 0 ? runEnd + 1 : agentAt >= 0 ? agentAt : surfaces.length;
    surfaces.splice(at, 0, spec);
  }
  return surfaces;
}
