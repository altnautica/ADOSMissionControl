"use client";

/**
 * @module fly/CockpitZones
 * @description Composes the registered cockpit widgets inside the flight
 * screen's centre zone. The registry (`widget-registry`) owns the SET of
 * widgets so a built-in OR a plugin adds a cockpit surface by registering
 * it; this composer renders the visible ones and OWNS their placement:
 *
 *   - an ARRANGEABLE widget (the chips + plugin widgets) is grouped by its
 *     effective zone (the operator's per-loadout override, else its default)
 *     and rendered inside one anchored zone container that the operator can
 *     move it between and hide. Each sits in a `data-widget="<id>"` wrapper so
 *     the stylesheet can relocate one widget without touching the others;
 *   - a non-arrangeable widget self-positions and is rendered bare.
 *
 * The flight instruments, the obstacle radar and the camera roster are not
 * widgets: they belong to the grid's centre, bottom-left card and camera
 * settings respectively.
 *
 * @license GPL-3.0-only
 */

import { Fragment, useMemo } from "react";

import { WhatsLockedChip } from "@/components/vision/WhatsLockedChip";
import { CockpitPerceptionChip } from "@/components/vision/CockpitPerceptionChip";
import type { CockpitLayout } from "@/stores/settings/keybindings-slice";
import { zoneContainerClass, type CockpitZone } from "@/lib/cockpit/zones";
import {
  effectiveWidgetZone,
  isCockpitWidgetVisible,
  useCockpitWidgetRegistry,
  type CockpitWidget,
  type CockpitWidgetContext,
} from "@/lib/cockpit/widget-registry";

/**
 * The built-in cockpit widgets, in one registry with any plugin widgets.
 *
 * Exported so a test can register the real definitions into a cleared
 * registry: `registerBuiltinCockpitWidgets` is module-guarded and becomes a
 * no-op after the first call, and a test that retyped these definitions would
 * not notice one of them losing `arrangeable` and going back to
 * self-anchoring.
 */
export const BUILTIN_WIDGETS: readonly CockpitWidget[] = [
  {
    // The "what's locked" chip: the shared readout of the designated target's
    // live lock state. Shown only while a target is selected (self-gated).
    id: "builtin.whats-locked",
    zone: "top-center",
    source: "builtin",
    arrangeable: true,
    title: "What's locked",
    order: 10,
    render: (ctx) => <WhatsLockedChip droneId={ctx.droneId} />,
  },
  {
    // The perception-health chip: LOCAL vs OFFLOAD ‹target› + a feed-freshness
    // dot, and an explicit "feed stale / offload link lost" escalation. Self-
    // gated (renders nothing when the drone runs no perception).
    id: "builtin.perception-health",
    zone: "top-left",
    source: "builtin",
    arrangeable: true,
    title: "Perception health",
    order: 20,
    render: (ctx) => <CockpitPerceptionChip droneId={ctx.droneId} />,
  },
];

let builtinsRegistered = false;

/** Register the built-in cockpit widgets once. Idempotent (module-guarded),
 * mirroring `registerBuiltinTargetActions`. */
export function registerBuiltinCockpitWidgets(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  const { register } = useCockpitWidgetRegistry.getState();
  for (const widget of BUILTIN_WIDGETS) register(widget);
}

interface CockpitZonesProps {
  droneId: string;
  layout: CockpitLayout;
}

export function CockpitZones({ droneId, layout }: CockpitZonesProps) {
  // Subscribe to the registry's item map; recompute the ordered list only when
  // the set changes. `resolve()` returns a fresh array, so it is memoized here
  // rather than used directly as a selector.
  const items = useCockpitWidgetRegistry((s) => s.items);
  const widgets = useMemo(
    // `items` is the reactive trigger; `resolve()` reads the same store's
    // ordered set. Recompute only when the registered set changes.
    () => (items.size ? useCockpitWidgetRegistry.getState().resolve() : []),
    [items],
  );

  const ctx = useMemo<CockpitWidgetContext>(() => ({ droneId }), [droneId]);

  // Split the visible set: self-positioning fixtures render bare; arrangeable
  // widgets are grouped by their effective zone into anchored containers.
  const { fixtures, zoned } = useMemo(() => {
    const fixtures: CockpitWidget[] = [];
    const zoned = new Map<CockpitZone, CockpitWidget[]>();
    for (const w of widgets) {
      if (!isCockpitWidgetVisible(w, layout)) continue;
      if (!w.arrangeable) {
        fixtures.push(w);
        continue;
      }
      const zone = effectiveWidgetZone(w, layout);
      const list = zoned.get(zone);
      if (list) list.push(w);
      else zoned.set(zone, [w]);
    }
    return { fixtures, zoned };
  }, [widgets, layout]);

  return (
    <>
      {fixtures.map((w) => (
        <Fragment key={w.id}>{w.render(ctx)}</Fragment>
      ))}
      {[...zoned.entries()].map(([zone, list]) => (
        <div key={zone} className={zoneContainerClass(zone)}>
          {list.map((w) => (
            <div key={w.id} data-widget={w.id}>
              {w.render(ctx)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
