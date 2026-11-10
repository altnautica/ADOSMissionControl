"use client";

/**
 * @module cockpit/flight/FlightTopBar
 * @description The flight screen's one top bar (cockpit spec `layout.json`
 * `top_bar`): flight-state chip · status pill · battery · link · navigation
 * source · controller · data-layer level · Menu · STOP.
 *
 * The bar never scrolls and never wraps. The Menu and STOP sit in a fixed end
 * group, so STOP is always fully visible. When the row runs out of room the
 * spec's `overflow.to_menu_order` moves items into the Menu one at a time:
 * the controller, the navigation source, the link's text, the link's icon,
 * then the layer button. The chip, the pill, the battery, the Menu and STOP
 * never move; once everything movable is in the Menu the pill truncates with
 * an ellipsis. The overflow is measured after each render and starts again
 * on a wider bar.
 *
 * STOP is always enabled. A press opens the emergency stop's hold-to-confirm
 * (`holds_ms.stop`); the stop is dispatched only once the operator completed
 * it, and the dispatcher still refuses it, with the reason, when the vehicle
 * cannot take it.
 *
 * @license GPL-3.0-only
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Menu, OctagonX } from "lucide-react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { specString } from "@/lib/cockpit/spec-strings";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { FlightStateChip } from "../v2/FlightStateChip";
import { LayerLevelButton } from "../layers/LayerLevelButton";
import { NavSourceChip } from "../NavSourceChip";
import { StatusPill } from "./StatusPill";
import { BatteryCell, ControllerCell, LinkCell } from "./TopBarCells";
import { FlightMenu } from "./FlightMenu";
import { useFlightSheet } from "./flight-sheet";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

/** A top-bar item that may move into the Menu. */
export type TopBarItem = "controller" | "nav_source" | "link_text" | "link_icon" | "layer_button";

interface TopBarZoneSpec {
  id: string;
  overflow?: { to_menu_order?: string[] };
}

/** The spec's order in which items move into the Menu, lowest priority first. */
export const TOP_BAR_OVERFLOW: readonly TopBarItem[] = (
  (layoutSpec.zones as unknown as TopBarZoneSpec[]).find((z) => z.id === "top_bar")?.overflow?.to_menu_order ?? []
) as TopBarItem[];

/** The items in the Menu after `stage` overflow steps. */
export function hiddenAt(stage: number): ReadonlySet<TopBarItem> {
  return new Set(TOP_BAR_OVERFLOW.slice(0, Math.max(0, stage)));
}

const MAX_STAGE = TOP_BAR_OVERFLOW.length;
const STOP_HOLD_MS = layoutSpec.holds_ms.stop;
const HIT_MIN = layoutSpec.touch_target.min;

/** The name the stop's confirm names the drone by. */
function stopTargetName(droneId: string): string {
  const managed = useDroneManager.getState().drones.get(droneId);
  if (managed?.name) return managed.name;
  return useNodeRegistryStore.getState().getEntry(droneId)?.presence?.name ?? droneId;
}

/**
 * Open the emergency stop's hold-to-confirm, whatever the vehicle state, and
 * hand the confirmed stop to the dispatcher (which re-reads the vehicle and
 * refuses with the reason when it cannot be sent).
 */
export async function requestStop(droneId: string): Promise<void> {
  const policy = useSkillRegistry.getState().skills.get("kill")?.confirm;
  if (!policy) return;
  const ctx = buildSkillContext(droneId);
  const confirmed = await ctx.confirm({
    ...policy,
    holdMs: STOP_HOLD_MS,
    values: { ...policy.values, drone: stopTargetName(droneId) },
  });
  if (!confirmed) return;
  await activate("kill", { ...buildSkillContext(droneId), confirm: async () => true });
}

function FlightTopBarInner({ droneId }: { droneId: string }) {
  const grid = useFlightGrid();
  const bar = grid.zones.top_bar;
  const barRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useFlightSheet("menu");
  // The stage is kept with the bar width it was measured at, so a wider bar
  // starts again from "everything on the bar".
  const [fit, setFit] = useState({ room: 0, stage: 0 });
  const stage = fit.stage;

  // The items row is as wide as its content; the main slot is as wide as the
  // bar leaves it beside the end group. Move one more item into the Menu
  // while the content does not fit.
  const measure = useCallback(() => {
    const el = barRef.current;
    const main = el?.querySelector<HTMLElement>(".fs-bar-main");
    const items = el?.querySelector<HTMLElement>(".fs-bar-items");
    if (!el || !main || !items) return;
    const room = el.clientWidth;
    const overflowing = items.scrollWidth > main.clientWidth + 1;
    setFit((f) => {
      if (room > f.room + 1 && f.stage > 0) return { room, stage: 0 };
      if (overflowing && f.stage < MAX_STAGE) return { room, stage: f.stage + 1 };
      return f.room === room ? f : { room, stage: f.stage };
    });
  }, []);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const sel of [".fs-bar-main", ".fs-bar-items"]) {
      const target = el.querySelector(sel);
      if (target) ro.observe(target);
    }
    return () => ro.disconnect();
  }, [measure]);

  // Re-check after every move: the row may still not fit.
  useLayoutEffect(() => {
    measure();
  }, [stage, measure]);

  if (!bar) return null;
  const hidden = hiddenAt(stage);
  const compact = grid.cls === "compact" || grid.cls === "portrait";
  const stopLabel = specString("stop.hold_label");

  return (
    <div
      ref={barRef}
      className="fs-panel fs-bar"
      data-zone="top_bar"
      data-overflow-stage={stage}
      data-overflow={stage >= MAX_STAGE ? "full" : stage > 0 ? "partial" : "none"}
      data-moved={[...hidden].join(" ")}
      style={{ ...rectStyle(bar), "--fs-hit": `${HIT_MIN}px` } as CSSProperties}
    >
      <div className="fs-bar-main">
        <div className="fs-bar-items">
          <FlightStateChip droneId={droneId} barWidth={bar.w} compact={compact} />
          <StatusPill droneId={droneId} />
          <BatteryCell droneId={droneId} />
          {!hidden.has("link_icon") && <LinkCell droneId={droneId} detail={!hidden.has("link_text")} />}
          {!hidden.has("nav_source") && <NavSourceChip droneId={droneId} />}
          {!hidden.has("controller") && <ControllerCell />}
        </div>
      </div>
      <div className="fs-bar-end">
        {!hidden.has("layer_button") && <LayerLevelButton droneId={droneId} iconOnly={compact} />}
        <button
          type="button"
          className="fs-btn fs-hit fs-icon-btn"
          data-testid="fs-menu-button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-label={specString("cockpit.menu")}
          title={specString("cockpit.menu")}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Menu className="fs-ico" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="fs-stop fs-hit"
          data-testid="cockpit-kill"
          data-hold-ms={STOP_HOLD_MS}
          style={{ width: grid.stop.w, height: grid.stop.h }}
          aria-label={stopLabel}
          title={stopLabel}
          onClick={() => void requestStop(droneId)}
        >
          <OctagonX className="fs-ico" aria-hidden="true" />
          <span>{specString("cockpit.stop")}</span>
        </button>
      </div>
      {menuOpen && <FlightMenu droneId={droneId} hidden={hidden} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

export const FlightTopBar = memo(FlightTopBarInner);
