"use client";

/**
 * @module cockpit/flight/FlightTopBar
 * @description The flight screen's one top bar (cockpit spec `layout.json`
 * `top_bar`): flight-state chip · status pill · battery · link · navigation
 * source · controller · data-layer level · Menu · STOP.
 *
 * The bar never scrolls and never wraps. The Menu and STOP sit in a fixed end
 * group, so STOP is always fully visible. When the row runs out of room the
 * spec's overflow order moves items into the Menu, lowest priority first:
 * the controller, then the navigation source, then the link's text (its
 * signal bars stay). The chip, the pill and the battery never move. The
 * overflow is measured after each render and starts again on a resize.
 *
 * @license GPL-3.0-only
 */

import { memo, useEffect, useRef, useState } from "react";
import { useFlightSheet } from "./flight-sheet";
import { Menu, OctagonX } from "lucide-react";

import { activate, buildSkillContext } from "@/lib/skills";
import { specString } from "@/lib/cockpit/spec-strings";
import { FlightStateChip } from "../v2/FlightStateChip";
import { LayerLevelButton } from "../layers/LayerLevelButton";
import { NavSourceChip } from "../NavSourceChip";
import { StatusPill } from "./StatusPill";
import { BatteryCell, ControllerCell, ControllerTour, LinkCell } from "./TopBarCells";
import { FlightMenu, type MenuOverflow } from "./FlightMenu";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

/** Overflow stages in the spec's `to_menu_order`. */
const MAX_STAGE = 3;

function overflowFor(stage: number): MenuOverflow {
  return { controller: stage >= 1, navSource: stage >= 2, linkDetail: stage >= 3 };
}

function FlightTopBarInner({ droneId }: { droneId: string }) {
  const grid = useFlightGrid();
  const bar = grid.zones.top_bar;
  const mainRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useFlightSheet("menu");
  // The stage is kept with the room it was measured in, so a wider bar starts
  // again from "everything on the bar".
  const [fit, setFit] = useState({ room: 0, stage: 0 });
  const stage = fit.stage;

  // The items row is as wide as its content; the main slot is as wide as the
  // bar allows. Whenever either changes, move one more item into the Menu
  // while the content does not fit.
  useEffect(() => {
    const main = mainRef.current;
    const items = itemsRef.current;
    if (!main || !items || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const room = main.clientWidth;
      const need = items.scrollWidth;
      setFit((f) => {
        if (room > f.room + 1 && f.stage > 0) return { room, stage: 0 };
        if (need > room + 1 && f.stage < MAX_STAGE) return { room, stage: f.stage + 1 };
        return f.room === room ? f : { room, stage: f.stage };
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    ro.observe(items);
    return () => ro.disconnect();
  }, []);

  if (!bar) return null;
  const overflow = overflowFor(stage);
  const compact = grid.cls === "compact" || grid.cls === "portrait";

  return (
    <div
      className="fs-panel fs-bar"
      data-zone="top_bar"
      data-overflow-stage={stage}
      style={rectStyle(bar)}
    >
      <div ref={mainRef} className="fs-bar-main">
        <div ref={itemsRef} className="fs-bar-items">
          <FlightStateChip droneId={droneId} />
          <StatusPill droneId={droneId} />
          <BatteryCell droneId={droneId} />
          <LinkCell droneId={droneId} detail={!overflow.linkDetail} />
          {!overflow.navSource && <NavSourceChip droneId={droneId} />}
          {!overflow.controller && <ControllerCell />}
        </div>
      </div>
      <div className="fs-bar-end">
        <LayerLevelButton droneId={droneId} iconOnly={compact} />
        <button
          type="button"
          className="fs-btn fs-icon-btn"
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
          className="fs-stop"
          data-testid="cockpit-kill"
          style={{ width: grid.stop.w, height: grid.stop.h }}
          title={specString("cockpit.stop")}
          onClick={() => void activate("kill", buildSkillContext(droneId), { gamepadButton: undefined })}
        >
          <OctagonX className="fs-ico" aria-hidden="true" />
          <span>{specString("cockpit.stop")}</span>
        </button>
      </div>
      <ControllerTour />
      {menuOpen && <FlightMenu droneId={droneId} overflow={overflow} onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

export const FlightTopBar = memo(FlightTopBarInner);
