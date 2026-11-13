"use client";

/**
 * @module cockpit/flight/FlightMenu
 * @description The top bar's Menu: everything that is not flight-critical
 * lives here rather than on the flight screen. Its sections follow the shared
 * spec's `menu.order`: the top-bar items the bar had no room for (only those
 * actually hidden), the cockpit view (in the spec's cycle order), the camera
 * streams and roster, the layer switches, the pre-flight checklist, the
 * flight modes (the Mode sheet), the controls, the extension panels, the
 * aircraft setup (only while the pilot reports setup is needed), the settings
 * and the way back to the drone page.
 *
 * @license GPL-3.0-only
 */

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Command, Gauge, Settings, Settings2, SlidersHorizontal, Wrench } from "lucide-react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { VIEW_CYCLE, useCockpitView, useCockpitViewStore, viewDef } from "@/lib/cockpit/views";
import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { AIRCRAFT_SETUP_HREF } from "@/components/shared/AircraftSetupBanner";
import { CameraPanel } from "./CameraSheet";
import { openFlightSheet } from "./flight-sheet";
import { NavSourceChip } from "../NavSourceChip";
import { LayerFlags, LayerLevelButton } from "../layers/LayerLevelButton";
import { LinkCell } from "./TopBarCells";
import { ControllerCell } from "./ControllerCell";
import { StickControlChip } from "../StickControlChip";
import { PREFLIGHT_SHEET, PreflightMenuRow } from "../PreflightSheet";
import type { TopBarItem } from "./FlightTopBar";

/** The Menu's sections, in the shared spec's order. */
export type MenuSection =
  | "overflow"
  | "view"
  | "cameras"
  | "layers"
  | "preflight"
  | "modes"
  | "controls"
  | "extension_panels"
  | "setup"
  | "settings"
  | "exit";

export const MENU_ORDER: readonly MenuSection[] = layoutSpec.menu.order as MenuSection[];

/** The route the app's settings live at. */
const SETTINGS_HREF = "/config";

/** The navigation source's popover, which the Menu's chip opens over it. */
const NAV_POPOVER = "[data-testid='nav-source-popover']";

export function FlightMenu({
  droneId,
  hidden,
  onClose,
}: {
  droneId: string;
  /** The top-bar items currently moved into the Menu. */
  hidden: ReadonlySet<TopBarItem>;
  onClose: () => void;
}) {
  const view = useCockpitView(droneId);
  const setView = useCockpitViewStore((s) => s.setView);
  const { pilot } = usePilotState(droneId);
  // Set up aircraft is offered only while the pilot reports setup is needed.
  const setupNeeded = pilot?.readiness.some((r) => r.id === "setup_needed" && !r.ok) ?? false;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    // The navigation source's popover, opened from the Menu, closes first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(NAV_POPOVER) !== null) return;
      // Consume the key: one Escape closes the Menu and nothing beneath it
      // (full screen stays on).
      e.preventDefault();
      e.stopPropagation();
      // Focus goes back to the Menu button, so the next Tab continues there.
      const button = document.querySelector<HTMLElement>("[data-testid='fs-menu-button']");
      onClose();
      button?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      const target = e.target as HTMLElement;
      if (el && !el.contains(target) && !target.closest(`[data-testid='fs-menu-button'], ${NAV_POPOVER}`)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  // Only what left the bar: the link's text alone while its icon is still there.
  const linkCell = hidden.has("link_icon") ? (
    <LinkCell droneId={droneId} detail inMenu />
  ) : hidden.has("link_text") ? (
    <LinkCell droneId={droneId} detail inMenu textOnly />
  ) : null;

  const sections: Record<MenuSection, ReactNode> = {
    overflow:
      hidden.size > 0 ? (
        <section className="fs-menu-sec" data-testid="fs-menu-overflow" data-section="overflow">
          {hidden.has("controller") && <ControllerCell />}
          {hidden.has("nav_source") && <NavSourceChip droneId={droneId} inMenu />}
          {linkCell}
          {hidden.has("layer_button") && <LayerLevelButton droneId={droneId} caret={false} />}
        </section>
      ) : null,
    view: (
      <section className="fs-menu-sec" data-section="view">
        <h3 className="fs-menu-h">{specString("cockpit.menu.view")}</h3>
        <div className="fs-seg" role="group" aria-label={specString("cockpit.menu.view")}>
          {VIEW_CYCLE.map((id) => (
            <button
              key={id}
              type="button"
              className="fs-hit"
              aria-pressed={view === id}
              data-testid={`fs-view-${id}`}
              onClick={() => setView(droneId, id)}
            >
              {viewDef(id).label}
            </button>
          ))}
        </div>
      </section>
    ),
    cameras: (
      <section className="fs-menu-sec" data-testid="fs-menu-cameras" data-section="cameras">
        <h3 className="fs-menu-h">{specString("cockpit.menu.cameras")}</h3>
        <CameraPanel droneId={droneId} />
      </section>
    ),
    layers: (
      <section className="fs-menu-sec" data-testid="fs-menu-layers" data-section="layers">
        <h3 className="fs-menu-h">{specString("cockpit.menu.layers")}</h3>
        <LayerFlags droneId={droneId} />
      </section>
    ),
    preflight: (
      <section className="fs-menu-sec fs-menu-actions" data-section="preflight">
        <PreflightMenuRow droneId={droneId} onOpen={run(() => openFlightSheet(PREFLIGHT_SHEET))} />
      </section>
    ),
    modes: (
      <section className="fs-menu-sec fs-menu-actions" data-section="modes">
        <button type="button" data-testid="fs-menu-modes" onClick={run(() => openFlightSheet("mode"))}>
          <Gauge className="fs-ico" aria-hidden="true" />
          {specString("cockpit.menu.modes")}
        </button>
      </section>
    ),
    controls: (
      <section className="fs-menu-sec" data-testid="fs-menu-controls" data-section="controls">
        <h3 className="fs-menu-h">{specString("cockpit.menu.controls")}</h3>
        <StickControlChip droneId={droneId} />
        <div className="fs-menu-actions">
          <button type="button" onClick={run(() => useSkillInputStore.getState().setEditorOpen(true))}>
            <Settings2 className="fs-ico" aria-hidden="true" />
            {specString("cockpit.menu.edit_controls")}
          </button>
        </div>
      </section>
    ),
    extension_panels: (
      <section className="fs-menu-sec fs-menu-actions" data-section="extension_panels">
        <button type="button" data-testid="fs-menu-extensions" onClick={run(() => useFlyQuickSettingsStore.getState().toggle())}>
          <SlidersHorizontal className="fs-ico" aria-hidden="true" />
          {specString("cockpit.menu.extension_panels")}
        </button>
      </section>
    ),
    setup: setupNeeded ? (
      <section className="fs-menu-sec fs-menu-actions" data-section="setup">
        <Link href={AIRCRAFT_SETUP_HREF} data-testid="fs-menu-setup" onClick={onClose}>
          <Wrench className="fs-ico" aria-hidden="true" />
          {specString("cockpit.menu.setup")}
        </Link>
      </section>
    ) : null,
    settings: (
      <section className="fs-menu-sec fs-menu-actions" data-section="settings">
        <Link href={SETTINGS_HREF} data-testid="fs-menu-settings" onClick={onClose}>
          <Settings className="fs-ico" aria-hidden="true" />
          {specString("cockpit.menu.settings")}
        </Link>
        <button type="button" onClick={run(() => useSkillInputStore.getState().setPaletteOpen(true))}>
          <Command className="fs-ico" aria-hidden="true" />
          {specString("cockpit.menu.palette")}
          <kbd>Ctrl K</kbd>
        </button>
      </section>
    ),
    // The Flight tab's strip replaces Exit; full screen is the top-bar button.
    exit: null,
  };

  return (
    <div ref={ref} role="dialog" aria-label={specString("cockpit.menu")} className="fs-sheet fs-menu" data-testid="fs-menu">
      {MENU_ORDER.map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
    </div>
  );
}
