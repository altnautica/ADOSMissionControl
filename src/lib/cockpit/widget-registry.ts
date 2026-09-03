"use client";

/**
 * @module cockpit/widget-registry
 * @description The cockpit widget/overlay registry. Every cockpit element —
 * the instrument HUD, radar, minimap, telemetry strip, the chips, and (via a
 * plugin host) plugin cockpit widgets — is a registered widget in one store, so
 * a built-in OR a plugin adds a cockpit surface by REGISTERING it, never by
 * editing `CockpitView`. This generalizes the Skill / target-action gold
 * pattern (built-in == plugin, one registry, one resolve) to the cockpit
 * surface.
 *
 * Placement grammar: a widget declares the `zone` it wants; the host
 * (`CockpitZones`) owns the actual positioning by rendering one anchored
 * container per zone and stacking that zone's ARRANGEABLE widgets inside it. A
 * widget marked `arrangeable` can be moved to another zone and hidden by the
 * operator (persisted per-loadout in `CockpitLayout.widgets`); a non-arrangeable
 * widget (the fixed instrument HUD / tapes) self-positions and is composed bare.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";

import { createContributionRegistry } from "@/lib/plugins/registries/contribution-registry";
import type { CockpitLayout } from "@/stores/settings/keybindings-slice";
import { type CockpitZone } from "@/lib/cockpit/zones";
import { meetsDensity, type CockpitDensity } from "@/lib/cockpit/density";

export type { CockpitZone };

/** What a widget's `render` receives to draw itself for the active drone. */
export interface CockpitWidgetContext {
  /** The drone whose cockpit this is (the globally-selected drone). */
  droneId: string;
}

/** One registered cockpit widget. Built-in and plugin widgets share this shape. */
export interface CockpitWidget {
  /** Stable unique id (`builtin.*` for built-ins, `plugin:<id>` for plugins). */
  id: string;
  /** The widget's DEFAULT placement zone (the operator can override it when
   * `arrangeable`). Non-arrangeable widgets ignore this and self-position. */
  zone: CockpitZone;
  /** Sort hint within a zone; unordered widgets sort after ordered ones. */
  order?: number;
  /** Provenance — a built-in widget and a plugin widget are one shape. */
  source: "builtin" | "plugin";
  /**
   * Whether the operator can move this widget between zones and hide it (the
   * chips + plugin widgets). When true the host places it in a zone container
   * and honours the per-loadout override; when false/absent the widget
   * self-positions (the fixed instrument HUD, the edge tapes) and is composed
   * bare, unchanged.
   */
  arrangeable?: boolean;
  /** Short human label for the layout editor / accessibility. */
  title?: string;
  /**
   * Maps this widget to an operator-toggleable `CockpitLayout` visibility flag
   * (the minimap / top bar / telemetry strip / radar chrome cards). Absent =
   * governed by the per-widget hidden override, then `defaultVisible`.
   */
  layoutKey?: keyof Pick<
    CockpitLayout,
    "topBar" | "minimap" | "telemetryStrip" | "proximityRadar"
  >;
  /** Visibility when no `layoutKey` and no per-widget override governs it.
   * Defaults to visible. */
  defaultVisible?: boolean;
  /**
   * Least dense cockpit mode at which this widget shows. Absent = every mode.
   *
   * This replaces the `.d-std` / `.d-full` CSS classes, which each widget hung
   * on its own positioning wrapper. A widget composed into a shared zone
   * container has no wrapper to carry a class, and having the stylesheet
   * decide density while the registry decides visibility meant two mechanisms
   * answering one question.
   */
  minDensity?: CockpitDensity;
  /** Render the widget for the active drone. */
  render: (ctx: CockpitWidgetContext) => ReactNode;
}

/**
 * The cockpit widget registry. A Zustand hook; call `.getState()` for
 * imperative access (register/unregister) and use a selector in components.
 */
export const useCockpitWidgetRegistry =
  createContributionRegistry<CockpitWidget>();

/** Register (or replace) a cockpit widget. The thin, source-agnostic entry
 * point a built-in feature or a plugin host uses — built-in == plugin. */
export function registerCockpitWidget(widget: CockpitWidget): void {
  useCockpitWidgetRegistry.getState().register(widget);
}

/** Remove a cockpit widget by id (plugin unmount / feature teardown). */
export function unregisterCockpitWidget(id: string): void {
  useCockpitWidgetRegistry.getState().unregister(id);
}

/**
 * The zone a widget actually renders in: the operator's per-loadout override
 * (only meaningful for an arrangeable widget) else the widget's default zone.
 */
export function effectiveWidgetZone(
  widget: CockpitWidget,
  layout: CockpitLayout,
): CockpitZone {
  if (widget.arrangeable) {
    const override = layout.widgets?.[widget.id]?.zone;
    if (override) return override;
  }
  return widget.zone;
}

/**
 * Whether a widget shows under the current loadout layout. Precedence:
 *  1. a widget bound to a `CockpitLayout` chrome flag follows that toggle;
 *  2. else a per-widget `hidden` override (the chips + plugin widgets) wins;
 *  3. else its own `defaultVisible` (default true).
 */
export function isCockpitWidgetVisible(
  widget: CockpitWidget,
  layout: CockpitLayout,
): boolean {
  // Density is a hard floor: a widget the operator has thinned out of the
  // cockpit is hidden regardless of the flags below, which is what the CSS
  // rules it replaces did.
  if (widget.minDensity && !meetsDensity(widget.minDensity, layout.density)) {
    return false;
  }
  if (widget.layoutKey) return layout[widget.layoutKey];
  const hidden = layout.widgets?.[widget.id]?.hidden;
  if (hidden !== undefined) return !hidden;
  return widget.defaultVisible ?? true;
}
