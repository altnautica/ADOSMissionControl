/**
 * @module VtolLandingConfigSection
 * @description VTOL landing pattern configuration UI.
 * Exposes the landing point, final-approach heading, transition distance and
 * approach altitude for the cruise -> transition -> vertical-landing sequence.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { landingApproachHeading } from "@/lib/patterns/landing-generator";
import { LandingPointPicker } from "./LandingPointPicker";

export function VtolLandingConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.vtolLandingConfig);
  const update = usePatternStore((s) => s.updateVtolLandingConfig);
  return (
    <>
      <LandingPointPicker
        landingPoint={config.landingPoint}
        onChange={(landingPoint) => update({ landingPoint })}
      />
      <Input label={t("approachHeading")} type="number" unit="deg" placeholder="0-360"
        value={config.approachHeading === undefined ? "" : String(config.approachHeading)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          update({ approachHeading: Number.isFinite(v) ? v : undefined });
        }} />
      {landingApproachHeading(config.approachHeading) === null && (
        <p className="text-[10px] text-status-warning">{t("approachHeadingRequired")}</p>
      )}
      <Input label={t("transitionDistance")} type="number" unit="m" value={String(config.transitionDistance ?? 150)}
        onChange={(e) => update({ transitionDistance: parseFloat(e.target.value) || 150 })} />
      <Input label={t("approachAltitude")} type="number" unit="m" value={String(config.approachAltitude ?? 50)}
        onChange={(e) => update({ approachAltitude: parseFloat(e.target.value) || 50 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("descentSpeed")} type="number" unit="m/s" value={String(config.descentSpeed ?? 2)}
          onChange={(e) => update({ descentSpeed: parseFloat(e.target.value) || 2 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 8)}
          onChange={(e) => update({ speed: parseFloat(e.target.value) || 8 })} />
      </div>
    </>
  );
}
