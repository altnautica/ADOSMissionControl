"use client";

/**
 * @module use-fleet-plugin-contributions
 * @description The fleet-scoped (no-drone) plugin contribution producer. It is
 * the fleet analogue of the per-drone `usePluginContributions(deviceId, slot)`:
 * where that hook joins ONE drone's enabled installs, this hook surfaces the
 * installs that target NO specific drone (a GCS-level / fleet-wide install,
 * `deviceId == null`) and projects their fleet-slot contributions into the
 * same `PluginSlotContribution & { slot }` rows a `<PluginHostProvider>` and a
 * `<PluginSlot>` consume.
 *
 * The fleet slots have NO per-drone binding — they mount once, app-wide, into
 * the chrome (settings nav, planner gallery, notification system, etc.) — so
 * the host is a single long-lived `deviceId={null}` provider, not the keyed
 * per-drone provider that tears down on drone switch.
 *
 * Implementation: it delegates the entire live cloud + local-first pipeline
 * (Convex query, blob lifecycle, handler lifecycle) to the existing
 * `usePluginContributions(null, slot)` producer, which already accepts a null
 * deviceId (the Convex query passes `deviceId: undefined`, the local-first hook
 * reads GCS-level installs from the local install store). Plugins installed on
 * a LAN-paired node reach the fleet slots through `FleetPluginSlot`, which
 * mounts each paired node's contributions beside these. The ONLY thing this
 * hook adds is the demo-mode
 * fleet mock set, because the live producer intentionally returns `[]` in demo
 * mode (it never mounts real iframes there). So `npm run demo` shows each
 * fleet slot lit by a demo plugin while production stays driven by real
 * installs.
 *
 * The per-drone path is untouched: callers that want a drone-bound slot keep
 * calling `usePluginContributions(deviceId, slot)`.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import { isDemoMode } from "@/lib/utils";
import { useHasMounted } from "@/hooks/use-has-mounted";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { PluginSlotName } from "@/lib/plugins/types";
import {
  getDemoFleetPluginContributions,
  type DemoFleetSlotContribution,
} from "@/mock/mock-plugins";

/** A renderable contribution carrying the slot it mounts into. */
type SlottedContribution = PluginSlotContribution & { slot: PluginSlotName };

const EMPTY: ReadonlyArray<SlottedContribution> = Object.freeze([]);

/**
 * A no-op bridge handler used for demo fleet contributions. The demo iframes
 * are visual fixtures only; their RPCs (if any) resolve to an inert ack so the
 * mock never throws for want of a wired handler. Production contributions get
 * the real handler surface from `buildPluginHandlers` via the live producer.
 */
const DEMO_HANDLERS: Record<string, never> = Object.freeze({}) as Record<
  string,
  never
>;

/**
 * Map a demo fleet slot fixture to the same `PluginSlotContribution & { slot }`
 * shape the live producer yields, so a fleet `<PluginSlot>` mounts a demo
 * contribution byte-identically to a real one. The bundle is a `data:` URL
 * carrying a tiny self-describing HTML document (null-origin, sandbox-safe)
 * so the iframe renders visibly without a Convex backend or a LAN agent.
 */
function toContribution(
  demo: DemoFleetSlotContribution,
): SlottedContribution {
  const granted = new Set<string>(demo.grantedCapabilities);
  return {
    slot: demo.slot,
    pluginId: demo.pluginId,
    panelId: demo.panelId,
    title: demo.title,
    bundleUrl: demo.bundleUrl,
    grantedCapabilities: granted,
    handlers: DEMO_HANDLERS,
    pluginInstallId: demo.installId,
  };
}

/**
 * Fleet-scoped plugin contributions, optionally narrowed to a single `slot`.
 * Returns a stable memoized array (same identity while the underlying set is
 * unchanged) ready to feed a fleet `<PluginHostProvider>` or a `<PluginSlot>`.
 *
 * In demo mode it returns the static demo fleet fixtures (so each fleet slot
 * is observable without a backend); otherwise it returns the live producer's
 * fleet (no-drone) contributions.
 */
export function useFleetPluginContributions(
  slot?: PluginSlotName,
): ReadonlyArray<SlottedContribution> {
  // Live path: the existing producer drives the cloud + local-first pipeline
  // for the fleet (null device). Returns [] in demo mode by design.
  const live = usePluginContributions(null, slot);

  // `isDemoMode()` resolves `?demo=true` from the URL, which only exists on the
  // client — so the server renders no demo fixtures while the client's first
  // render would. Surfacing the demo set only AFTER mount keeps the first
  // client render identical to the SSR output (both `live`, i.e. empty in demo)
  // and defers the demo contributions to a post-hydration pass. Without this,
  // a fleet slot host (e.g. the /config settings.section) renders nothing on
  // the server but a whole section on the client → hydration mismatch (#418).
  const mounted = useHasMounted();

  return useMemo(() => {
    if (!mounted || !isDemoMode()) return live;
    const demos = getDemoFleetPluginContributions()
      .filter((d) => (slot ? d.slot === slot : true))
      .map(toContribution);
    if (demos.length === 0) return EMPTY;
    // Stable sort by order then plugin id — same contract as the live producer.
    return [...demos]
      .map((c, i) => ({ c, order: getDemoOrder(c.pluginId, c.panelId), i }))
      .sort((a, b) =>
        a.order !== b.order
          ? a.order - b.order
          : a.c.pluginId.localeCompare(b.c.pluginId),
      )
      .map((entry) => entry.c);
  }, [live, slot, mounted]);
}

/** Resolve the sort order for a demo contribution from its fixture. */
function getDemoOrder(pluginId: string, panelId: string): number {
  const match = getDemoFleetPluginContributions().find(
    (d) => d.pluginId === pluginId && d.panelId === panelId,
  );
  return match?.order ?? 60;
}
