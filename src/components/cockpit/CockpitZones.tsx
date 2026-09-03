"use client";

/**
 * @module fly/CockpitZones
 * @description Composes the registered cockpit widgets over the video. The
 * registry (`widget-registry`) owns the SET of widgets so a built-in OR a
 * plugin adds a cockpit surface by registering it; this composer renders the
 * visible ones and OWNS their placement:
 *
 *   - an ARRANGEABLE widget (the chips + plugin widgets) is grouped by its
 *     effective zone (the operator's per-loadout override, else its default)
 *     and rendered inside one anchored zone container that the operator can
 *     move it between and hide;
 *   - a non-arrangeable widget (the fixed instrument HUD, the edge tapes)
 *     self-positions and is rendered bare, unchanged.
 *
 * @license GPL-3.0-only
 */

import { Fragment, useMemo } from "react";

import { ProximityRadar } from "@/components/flight/ProximityRadar";
import { TelemetryStrip } from "@/components/cockpit/TelemetryStrip";
import { WhatsLockedChip } from "@/components/vision/WhatsLockedChip";
import { CockpitPerceptionChip } from "@/components/vision/CockpitPerceptionChip";
import { CockpitCameraRoster } from "@/components/vision/CockpitCameraRoster";
import { AttitudeIndicator } from "@/components/cockpit/AttitudeIndicator";
import { SpeedTape, AltTape } from "@/components/cockpit/Tapes";
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
    // The artificial horizon: pitch ladder + roll arc + boresight, over video.
    id: "builtin.attitude",
    zone: "center",
    source: "builtin",
    order: 1,
    render: () => <AttitudeIndicator />,
  },
  {
    // Ground-speed tape, hugging the left video edge.
    id: "builtin.speed-tape",
    zone: "left",
    source: "builtin",
    order: 1,
    render: () => <SpeedTape />,
  },
  {
    // Altitude tape (rolling-digit readout), hugging the right video edge.
    id: "builtin.alt-tape",
    zone: "right",
    source: "builtin",
    order: 1,
    render: () => <AltTape />,
  },
  {
    // Arrangeable, so it shares the bottom-right zone container with any
    // operator or plugin widget there instead of self-anchoring on top of it:
    // both used to sit at the same coordinates and the same z-index, leaving
    // paint order (i.e. DOM order) to decide which one the operator saw.
    id: "builtin.proximity-radar",
    zone: "bottom-right",
    source: "builtin",
    arrangeable: true,
    title: "Proximity radar",
    layoutKey: "proximityRadar",
    // Was the `.d-std` class on its own wrapper, which a widget composed into
    // a shared container has nowhere to put.
    minDensity: "standard",
    order: 10,
    render: () => <ProximityRadar />,
  },
  {
    // Same, for the bottom-left container it shared with the camera roster.
    id: "builtin.telemetry-strip",
    zone: "bottom-left",
    source: "builtin",
    arrangeable: true,
    title: "Telemetry strip",
    layoutKey: "telemetryStrip",
    // Was the `.d-full` class on its own wrapper.
    minDensity: "full",
    order: 10,
    render: () => <TelemetryStrip />,
  },
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
  {
    // The multi-camera roster: the node's cameras (from the capability probe),
    // each with a real live / idle badge. Default bottom-left so it never
    // overlaps the top-right density / video-stats / camera-pill cluster.
    // Self-gated — nothing to show for a single-camera drone. Arrangeable.
    id: "builtin.camera-roster",
    zone: "bottom-left",
    source: "builtin",
    arrangeable: true,
    title: "Cameras",
    order: 20,
    render: () => <CockpitCameraRoster />,
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
            <Fragment key={w.id}>{w.render(ctx)}</Fragment>
          ))}
        </div>
      ))}
    </>
  );
}
