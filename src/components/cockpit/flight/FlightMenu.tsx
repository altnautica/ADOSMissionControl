"use client";

/**
 * @module cockpit/flight/FlightMenu
 * @description The top bar's Menu: everything that is not flight-critical
 * lives here rather than on the flight screen. Top-bar items the bar had no
 * room for (controller, navigation source, link detail), the cockpit view,
 * the camera streams and roster, the command palette, the extension quick
 * settings, the control editor, immersive (fullscreen) mode and the way back
 * to the drone page.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Command, Expand, LogOut, Minimize, Settings2, SlidersHorizontal } from "lucide-react";

import { COCKPIT_VIEWS, useCockpitView, useCockpitViewStore } from "@/lib/cockpit/views";
import { specString } from "@/lib/cockpit/spec-strings";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useUiStore } from "@/stores/ui-store";
import { CameraPanel } from "./CameraSheet";
import { NavSourceChip } from "../NavSourceChip";
import { ControllerCell, LinkCell } from "./TopBarCells";
import { StickControlChip } from "../StickControlChip";
import { PreflightChip } from "../PreflightChip";

export interface MenuOverflow {
  controller: boolean;
  navSource: boolean;
  linkDetail: boolean;
}

/** Leave the flight screen for the drone page (its Overview tab). */
export function exitFlightScreen(): void {
  const ui = useUiStore.getState();
  if (ui.immersiveMode) ui.exitImmersiveMode();
  ui.setPendingDetailTab("overview");
}

export function FlightMenu({
  droneId,
  overflow,
  onClose,
}: {
  droneId: string;
  overflow: MenuOverflow;
  onClose: () => void;
}) {
  const t = useTranslations("flightScreen.menu");
  const view = useCockpitView(droneId);
  const setView = useCockpitViewStore((s) => s.setView);
  const immersive = useUiStore((s) => s.immersiveMode);
  const ref = useRef<HTMLDivElement>(null);
  const anyOverflow = overflow.controller || overflow.navSource || overflow.linkDetail;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      const target = e.target as HTMLElement;
      if (el && !el.contains(target) && !target.closest("[data-testid='fs-menu-button']")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div ref={ref} role="dialog" aria-label={specString("cockpit.menu")} className="fs-sheet fs-menu" data-testid="fs-menu">
      {anyOverflow && (
        <section className="fs-menu-sec" data-testid="fs-menu-overflow">
          {overflow.linkDetail && <LinkCell droneId={droneId} detail />}
          {overflow.navSource && <NavSourceChip droneId={droneId} />}
          {overflow.controller && <ControllerCell />}
        </section>
      )}
      <section className="fs-menu-sec">
        <h3 className="fs-menu-h">{t("view")}</h3>
        <div className="fs-seg" role="group" aria-label={t("view")}>
          {COCKPIT_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              data-testid={`fs-view-${v.id}`}
              onClick={() => setView(droneId, v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </section>
      <section className="fs-menu-sec" data-testid="fs-menu-cameras">
        <h3 className="fs-menu-h">{t("cameras")}</h3>
        <CameraPanel droneId={droneId} />
      </section>
      <section className="fs-menu-sec" data-testid="fs-menu-controls">
        <h3 className="fs-menu-h">{t("controls")}</h3>
        <StickControlChip droneId={droneId} />
        <PreflightChip droneId={droneId} />
      </section>
      <section className="fs-menu-sec fs-menu-actions">
        <button type="button" onClick={run(() => useSkillInputStore.getState().setPaletteOpen(true))}>
          <Command className="fs-ico" aria-hidden="true" />
          {t("palette")}
          <kbd>Ctrl K</kbd>
        </button>
        <button type="button" onClick={run(() => useFlyQuickSettingsStore.getState().toggle())}>
          <SlidersHorizontal className="fs-ico" aria-hidden="true" />
          {t("quickSettings")}
        </button>
        <button type="button" onClick={run(() => useSkillInputStore.getState().setEditorOpen(true))}>
          <Settings2 className="fs-ico" aria-hidden="true" />
          {t("editControls")}
        </button>
        <button
          type="button"
          data-testid="fs-immersive"
          aria-pressed={immersive}
          onClick={run(() => {
            const ui = useUiStore.getState();
            if (ui.immersiveMode) ui.exitImmersiveMode();
            else ui.enterImmersiveMode();
          })}
        >
          {immersive ? <Minimize className="fs-ico" aria-hidden="true" /> : <Expand className="fs-ico" aria-hidden="true" />}
          {immersive ? t("leaveImmersive") : t("immersive")}
        </button>
        <button type="button" data-testid="fs-exit" onClick={run(exitFlightScreen)}>
          <LogOut className="fs-ico" aria-hidden="true" />
          {t("exit")}
        </button>
      </section>
    </div>
  );
}
