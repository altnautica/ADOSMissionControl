/**
 * @module HomeLaunchSection
 * @description Where the plan launches and returns to, and how high it flies
 * to and from the work area. The planned home row shows the coordinate in the
 * operator's format and the ground under it, with a one-shot "pick on map"
 * and, when the selected vehicle reports a different home at this site, a
 * button to adopt it. The transit altitude is optional: empty is off. The
 * place the plan flies in (open, or a confined place such as a mine, tunnel
 * or room) is saved with the plan and set on the drone's pilot before launch.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Crosshair } from "lucide-react";
import { PropertySection } from "@/components/ui/property-section";
import { PropertyRow } from "@/components/ui/property-row";
import { ScrubNumberField } from "@/components/ui/scrub-number-field";
import { Tooltip } from "@/components/ui/tooltip";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVehicleHomeOffer } from "@/hooks/use-vehicle-home-offer";
import { formatCursorCoord } from "@/lib/planner/cursor-coord";
import { formatAltitude } from "@/lib/units/format";
import { cn } from "@/lib/utils";
import { PlaceClassPicker } from "@/components/cockpit/v2/PlaceClassPicker";

export function HomeLaunchSection() {
  const t = useTranslations("planner.inspector.home");
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const setPlannedHome = useMissionStore((s) => s.setPlannedHome);
  const transitAltM = useMissionStore((s) => s.transitAltM);
  const setTransitAlt = useMissionStore((s) => s.setTransitAlt);
  const placeClass = useMissionStore((s) => s.placeClass);
  const setPlaceClass = useMissionStore((s) => s.setPlaceClass);
  const homePickArmed = usePlannerStore((s) => s.homePickArmed);
  const setHomePickArmed = usePlannerStore((s) => s.setHomePickArmed);
  const coordFormat = useSettingsStore((s) => s.coordFormat);
  const units = useSettingsStore((s) => s.units);
  const vehicleHome = useVehicleHomeOffer();

  const pickLabel = homePickArmed ? t("pickCancel") : t("pickOnMap");

  return (
    <PropertySection title={t("title")} collapsible persistKey="home">
      <PropertyRow label={t("plannedHome")}
        trailing={
          <Tooltip content={pickLabel} position="left">
            <button type="button" aria-label={pickLabel} aria-pressed={homePickArmed}
              onClick={() => setHomePickArmed(!homePickArmed)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded cursor-pointer focus-ring transition-colors",
                homePickArmed
                  ? "bg-accent-primary text-accent-foreground"
                  : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
              )}>
              <Crosshair size={14} />
            </button>
          </Tooltip>
        }>
        {plannedHome ? (
          <div className="flex min-w-0 flex-col py-1" data-testid="planned-home">
            <span className="truncate font-mono text-xs text-text-primary">
              {formatCursorCoord(plannedHome.lat, plannedHome.lon, coordFormat)}
            </span>
            <span className="text-[11px] text-text-tertiary">
              {plannedHome.groundAmsl !== undefined
                ? t("groundMsl", { alt: formatAltitude(plannedHome.groundAmsl, units) })
                : t("groundUnknown")}
            </span>
          </div>
        ) : (
          <span className="text-xs text-text-tertiary" data-testid="planned-home">{t("notSet")}</span>
        )}
      </PropertyRow>
      {vehicleHome && (
        <div className="flex justify-end">
          <button type="button"
            // HOME_POSITION altitude is the ground at the launch point, AMSL.
            onClick={() => setPlannedHome({
              lat: vehicleHome.lat,
              lon: vehicleHome.lon,
              ...(Number.isFinite(vehicleHome.alt) ? { groundAmsl: vehicleHome.alt } : {}),
            })}
            className="flex h-7 items-center rounded border border-border-default px-2 text-[11px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer focus-ring">
            {t("useVehicleHome")}
          </button>
        </div>
      )}
      <PropertyRow label={t("transitAlt")}>
        <ScrubNumberField value={transitAltM} step={5} min={1} unit="m" placeholder={t("off")}
          ariaLabel={t("transitAlt")} onCommit={setTransitAlt} onClear={() => setTransitAlt(null)} />
      </PropertyRow>
      <p className="mt-1 text-[11px] text-text-tertiary">{t("transitHint")}</p>
      <div className="mt-3">
        <PlaceClassPicker value={placeClass} onChange={setPlaceClass} />
      </div>
    </PropertySection>
  );
}
